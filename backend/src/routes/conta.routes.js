// Conta do tenant: plano, situacao da assinatura, assistente de inicio e
// configuracoes da Fase 1 (link publico, caixa automatico, lembretes).
//
//   GET  /conta/resumo        -> tudo que o front precisa pro banner + checklist
//   PUT  /conta/configuracoes -> { slugPublico?, caixaAutomatico?, configLembrete? }
//
// Sem requerModuloLiberado de proposito: precisa responder mesmo com o
// trial vencido (e justamente quando o banner mais importa). A escrita
// respeita o bloqueio suave pela checagem explicita abaixo.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerTenant, requerPapelPrivilegiado, ehAdmin } = require('../middlewares/permissoes.middleware');
const { situacaoAssinatura } = require('../assinatura/situacao');
const { obterPlano, planosPublicos } = require('../planos/catalogo');
const { carregarPassos } = require('../onboarding/passos');
const { slugBase } = require('../onboarding/cadastro');
const { configLembreteEfetiva, contarLembretesDoMes } = require('../agenda/lembretes');
const { limiteDo } = require('../planos/recursos');
const rateLimit = require('express-rate-limit');
const { assinarPlano, cancelarAssinatura } = require('../assinatura/cobranca');
const { validarDocumento } = require('../utils/validacaoFiscal');
const asaasPlataforma = require('../assinatura/asaasPlataforma');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);

function clienteIdDe(req) {
  return ehAdmin(req.usuario) ? req.query.clienteId || req.body?.clienteId : req.usuario.clienteId;
}

roteador.get('/resumo', async (req, res) => {
  try {
    const clienteId = clienteIdDe(req);
    if (!clienteId) return res.status(400).json({ erro: 'clienteId obrigatorio.' });
    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: {
        nome: true, segmento: true, plano: true, statusAssinatura: true, trialAte: true,
        slugPublico: true, caixaAutomatico: true, configLembrete: true,
        cicloAssinatura: true, formaPagamento: true, canceladoEm: true, cpfCnpj: true, asaasAssinaturaId: true,
      },
    });
    if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado.' });

    const situacao = situacaoAssinatura(cliente);
    const plano = planosPublicos().find((p) => p.codigo === situacao.planoEfetivo);
    const [inicio, lembretesNoMes] = await Promise.all([
      carregarPassos(clienteId),
      contarLembretesDoMes(clienteId),
    ]);

    res.json({
      negocio: { nome: cliente.nome, segmento: cliente.segmento },
      assinatura: {
        ...situacao,
        trialAte: cliente.trialAte,
        planoContratado: { codigo: cliente.plano, nome: obterPlano(cliente.plano).nome },
        ciclo: cliente.cicloAssinatura,
        formaPagamento: cliente.formaPagamento,
        canceladoEm: cliente.canceladoEm,
        temDocumento: Boolean(cliente.cpfCnpj),
        cobrancaAutomatica: asaasPlataforma.ativo(),
        assinaturaAutomaticaAtiva: Boolean(cliente.asaasAssinaturaId),
      },
      plano,
      inicio,
      configuracoes: {
        slugPublico: cliente.slugPublico,
        caixaAutomatico: cliente.caixaAutomatico,
        lembrete: configLembreteEfetiva(cliente.configLembrete),
      },
      uso: {
        lembretesNoMes,
        lembretesLimite: limiteDo(cliente, 'lembretesMes'),
      },
    });
  } catch (e) {
    console.error('[conta/resumo]', e);
    res.status(500).json({ erro: 'Erro ao carregar a conta.' });
  }
});

roteador.put('/configuracoes', requerPapelPrivilegiado, async (req, res) => {
  try {
    const clienteId = clienteIdDe(req);
    if (!clienteId) return res.status(400).json({ erro: 'clienteId obrigatorio.' });
    const atual = await prisma.cliente.findUnique({
      where: { id: clienteId }, select: { plano: true, statusAssinatura: true, trialAte: true },
    });
    if (!atual) return res.status(404).json({ erro: 'Cliente nao encontrado.' });
    if (!ehAdmin(req.usuario) && situacaoAssinatura(atual).somenteLeitura) {
      return res.status(402).json({ erro: 'Conta em modo somente leitura.', codigo: 'ASSINATURA_BLOQUEADA' });
    }

    const { slugPublico, caixaAutomatico, configLembrete } = req.body || {};
    const data = {};

    if (slugPublico !== undefined) {
      const slug = slugBase(slugPublico);
      if (slug.length < 3) return res.status(422).json({ erro: 'O endereço precisa de pelo menos 3 letras ou números.', campos: ['slugPublico'] });
      const dono = await prisma.cliente.findUnique({ where: { slugPublico: slug }, select: { id: true } });
      if (dono && dono.id !== clienteId) return res.status(409).json({ erro: 'Esse endereço já está em uso. Tente outro.', campos: ['slugPublico'] });
      data.slugPublico = slug;
    }
    if (caixaAutomatico !== undefined) data.caixaAutomatico = caixaAutomatico === true;
    if (configLembrete !== undefined) {
      if (configLembrete !== null && typeof configLembrete !== 'object') {
        return res.status(422).json({ erro: 'configLembrete invalida.', campos: ['configLembrete'] });
      }
      data.configLembrete = configLembrete === null ? null : configLembreteEfetiva(configLembrete);
    }

    const atualizado = await prisma.cliente.update({
      where: { id: clienteId }, data,
      select: { slugPublico: true, caixaAutomatico: true, configLembrete: true },
    });
    res.json({ ...atualizado, configLembrete: configLembreteEfetiva(atualizado.configLembrete) });
  } catch (e) {
    console.error('[conta/configuracoes]', e);
    res.status(500).json({ erro: 'Erro ao salvar as configurações.' });
  }
});

// Limite proprio pras acoes de dinheiro (assinar/cancelar): evita abuso
// contra a API do Asaas em nome do Sellergy.
const limitadorAssinatura = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente de novo em alguns minutos.' },
});

// O dono escolhe o plano (no teste, no fim dele ou trocando).
//   body: { plano, ciclo?: 'MENSAL'|'ANUAL', formaPagamento?: 'PIX'|'CREDIT_CARD'|'BOLETO'|'UNDEFINED', cpfCnpj? }
// Com a cobranca automatica ligada, devolve linkPagamento (pagina do Asaas).
roteador.post('/assinar', limitadorAssinatura, async (req, res) => {
  try {
    if (req.usuario.perfil !== 'CLIENT') return res.status(403).json({ erro: 'Só o dono da conta pode escolher o plano.' });
    const { plano, ciclo = 'MENSAL', formaPagamento = 'UNDEFINED', cpfCnpj, cupom } = req.body || {};
    if (!['BASIC', 'PRO', 'PREMIUM'].includes(plano)) return res.status(422).json({ erro: 'Plano inválido.', campos: ['plano'] });
    if (!['MENSAL', 'ANUAL'].includes(ciclo)) return res.status(422).json({ erro: 'Ciclo inválido.', campos: ['ciclo'] });
    if (!['PIX', 'CREDIT_CARD', 'BOLETO', 'UNDEFINED'].includes(formaPagamento)) return res.status(422).json({ erro: 'Forma de pagamento inválida.', campos: ['formaPagamento'] });
    if (cpfCnpj !== undefined && cpfCnpj !== null && cpfCnpj !== '' && !validarDocumento(cpfCnpj)) {
      return res.status(422).json({ erro: 'CPF ou CNPJ inválido.', campos: ['cpfCnpj'] });
    }
    // Cupom (cadastrado no painel admin, Planos e precos).
    let extra = {};
    let cupomUsado = null;
    if (cupom) {
      const { lerCupons, gravarCupons, validarCupomParaAssinatura } = require('../admin/planos');
      const cupons = await lerCupons();
      const v = validarCupomParaAssinatura(cupons, cupom);
      if (!v.ok) return res.status(422).json({ erro: v.erro, campos: ['cupom'] });
      cupomUsado = v.cupom;
      if (cupomUsado.tipo === 'MESES_GRATIS') extra = { carenciaMeses: cupomUsado.valor };
      else extra = { mensalidade: Math.round(obterPlano(plano).precoMensal * (1 - cupomUsado.valor / 100) * 100) / 100 };
      await gravarCupons(cupons.map((c) => (c.codigo === cupomUsado.codigo ? { ...c, usos: (c.usos || 0) + 1 } : c)));
    }
    const r = await assinarPlano(req.usuario.clienteId, plano, { ciclo, formaPagamento, cpfCnpj: cpfCnpj ? String(cpfCnpj).replace(/\D/g, '') : undefined, ...extra });
    if (cupomUsado?.tipo === 'PERCENTUAL' && cupomUsado.duracaoMeses) {
      const { registrarDescontoTemporario, somarMeses } = require('../assinatura/cobranca');
      await registrarDescontoTemporario(req.usuario.clienteId, somarMeses(new Date(), cupomUsado.duracaoMeses));
    }
    res.status(201).json({
      plano: obterPlano(r.cliente.plano).nome,
      ciclo: r.cliente.cicloAssinatura,
      statusAssinatura: r.cliente.statusAssinatura,
      modo: r.modo,
      linkPagamento: r.linkPagamento,
      fatura: r.fatura,
    });
  } catch (e) {
    if (e.status === 422) return res.status(422).json({ erro: e.message, campos: e.campos || [] });
    if (e.codigo === 'ASAAS_PLATAFORMA') {
      console.error('[conta/assinar] asaas', e.status, e.message);
      return res.status(502).json({ erro: 'Não conseguimos falar com o sistema de pagamento agora. Tente de novo em alguns minutos.', detalhe: e.status === 400 ? e.message : undefined });
    }
    console.error('[conta/assinar]', e);
    res.status(500).json({ erro: 'Erro ao assinar o plano.' });
  }
});

// O dono cancela. Conta fica so pra consulta; nada e apagado.
roteador.post('/cancelar', limitadorAssinatura, async (req, res) => {
  try {
    if (req.usuario.perfil !== 'CLIENT') return res.status(403).json({ erro: 'Só o dono da conta pode cancelar.' });
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 300) : null;
    const cliente = await cancelarAssinatura(req.usuario.clienteId, { motivo });
    res.json(cliente);
  } catch (e) {
    console.error('[conta/cancelar]', e?.message);
    res.status(500).json({ erro: 'Erro ao cancelar a assinatura.' });
  }
});

roteador.get('/faturas', async (req, res) => {
  try {
    const clienteId = clienteIdDe(req);
    if (!clienteId) return res.status(400).json({ erro: 'clienteId obrigatorio.' });
    const faturas = await prisma.faturaAssinatura.findMany({
      where: { clienteId }, orderBy: { vencimento: 'desc' }, take: 24,
      select: { id: true, competencia: true, valor: true, vencimento: true, status: true, linkPagamento: true, pagaEm: true },
    });
    res.json(faturas);
  } catch (e) {
    console.error('[conta/faturas]', e);
    res.status(500).json({ erro: 'Erro ao listar faturas.' });
  }
});

module.exports = roteador;
