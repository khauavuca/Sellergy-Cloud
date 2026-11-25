// Conta do tenant: plano, situacao da assinatura, assistente de inicio e
// configuracoes da Fase 1 (link publico, caixa automatico, lembretes).
//
//   GET  /conta/resumo        -> tudo que o front precisa pro banner + checklist
//   PUT  /conta/configuracoes -> { slugPublico?, caixaAutomatico?, configLembrete? }
//   GET  /conta/online        -> o que falta pro link de agendamento e pro catalogo online
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
const { validarSlug } = require('../seguranca/validarConta');
const { configLembreteEfetiva, contarLembretesDoMes } = require('../agenda/lembretes');
const { limiteDo } = require('../planos/recursos');
const { contarNotasDoMes } = require('../fiscal/limiteNotas');
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

// Link de agendamento e catalogo online: links e a lista do que falta.
roteador.get('/online', async (req, res) => {
  try {
    const clienteId = clienteIdDe(req);
    if (!clienteId) return res.status(400).json({ erro: 'clienteId obrigatorio.' });
    const cliente = await prisma.cliente.findUnique({
      where: { id: clienteId },
      select: {
        slugPublico: true, horarioFuncionamento: true, modulosLiberados: true, telefone: true,
        plano: true, statusAssinatura: true, trialAte: true,
        configuracaoCatalogo: { select: { online: true, aceitaRetirada: true, aceitaEntrega: true, freteEntrega: true } },
      },
    });
    if (!cliente) return res.status(404).json({ erro: 'Cliente nao encontrado.' });
    const { temRecurso } = require('../planos/recursos');
    const { HORARIO_PADRAO } = require('../services/agendaSlots');
    const base = (process.env.APP_URL_PUBLICA || process.env.VITE_URL_PUBLICA || '').replace(/\/$/, '');
    const slug = cliente.slugPublico || null;

    const [servicos, profissionais, produtos, bots] = await Promise.all([
      prisma.produto.findMany({
        where: { clienteId, tipo: 'SERVICO', visibilidade: 'ATIVO' },
        select: { variacoes: { select: { preco: true, duracaoMin: true } } },
      }),
      prisma.especialista.count({ where: { clienteId, ativo: true } }),
      prisma.produto.count({ where: { clienteId, tipo: 'FISICO', visibilidade: 'ATIVO', variacoes: { some: { preco: { gt: 0 } } } } }),
      prisma.bot.findMany({
        where: { clienteId },
        select: { provedorCanal: true, statusConexaoBaileys: true, baileysNumeroConectado: true, oficialNumeroExibicao: true, webhookConfirmadoEm: true },
      }),
    ]);
    const servicosNoLink = servicos.filter((sv) => sv.variacoes.some((v) => Number.isFinite(v.preco) && v.preco >= 0)).length;
    const h = cliente.horarioFuncionamento && typeof cliente.horarioFuncionamento === 'object' ? cliente.horarioFuncionamento : null;
    const hv = h || HORARIO_PADRAO;
    const conectado = bots.find((b) => (b.provedorCanal === 'BAILEYS' && b.statusConexaoBaileys === 'CONECTADO')
      || (b.provedorCanal === 'META_CLOUD' && b.webhookConfirmadoEm));
    const numeroZap = conectado
      ? (conectado.provedorCanal === 'BAILEYS' ? conectado.baileysNumeroConectado : String(conectado.oficialNumeroExibicao || '').split('·')[0].trim()) || null
      : null;
    const cat = cliente.configuracaoCatalogo;

    const agendaLiberada = cliente.modulosLiberados?.AGENDA === true && temRecurso(cliente, 'linkAgendamento');
    const lojaLiberada = cliente.modulosLiberados?.VENDAS === true && temRecurso(cliente, 'catalogoOnline');
    res.json({
      slug,
      agenda: agendaLiberada ? {
        link: slug && base ? `${base}/agendar/${slug}` : null,
        horario: { salvo: Boolean(h), abertura: hv.abertura, fechamento: hv.fechamento, dias: hv.dias },
        servicos: servicosNoLink,
        profissionais,
        pronto: Boolean(slug) && servicosNoLink > 0 && profissionais > 0,
      } : null,
      loja: lojaLiberada ? {
        link: slug && base ? `${base}/loja/${slug}` : null,
        online: Boolean(cat?.online),
        produtos,
        whatsapp: numeroZap || cliente.telefone || null,
        whatsappDoBot: Boolean(numeroZap),
        retirada: Boolean(cat?.aceitaRetirada),
        entrega: Boolean(cat?.aceitaEntrega),
        frete: cat?.aceitaEntrega ? Number(cat.freteEntrega) || 0 : null,
        pronto: Boolean(slug) && Boolean(cat?.online) && produtos > 0 && Boolean(cat?.aceitaRetirada || cat?.aceitaEntrega),
      } : null,
    });
  } catch (erro) {
    console.error('[conta/online]', erro);
    res.status(500).json({ erro: 'Erro ao carregar a agenda e a loja online.' });
  }
});

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
    const [inicio, lembretesNoMes, notasNoMes] = await Promise.all([
      carregarPassos(clienteId),
      contarLembretesDoMes(clienteId),
      contarNotasDoMes(clienteId),
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
        // Notas fiscais do mes (teto do plano: limite notasMes).
        notasNoMes,
        notasLimite: limiteDo(cliente, 'notasMes'),
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
      // Endereco invalido ou reservado ("admin", "api"...) e recusado, nunca
      // trocado calado por outro.
      const v = validarSlug(slugPublico);
      if (v.erro) return res.status(422).json({ erro: v.erro, campos: v.campos });
      const slug = v.valor;
      const dono = await prisma.cliente.findUnique({ where: { slugPublico: slug }, select: { id: true } });
      if (dono && dono.id !== clienteId) return res.status(409).json({ erro: 'Esse endereço já está em uso. Tente outro.', campos: ['slugPublico'] });
      data.slugPublico = slug;
    }
    if (caixaAutomatico !== undefined) {
      if (typeof caixaAutomatico !== 'boolean') return res.status(422).json({ erro: 'caixaAutomatico precisa ser verdadeiro ou falso.', campos: ['caixaAutomatico'] });
      data.caixaAutomatico = caixaAutomatico;
    }
    if (configLembrete !== undefined) {
      if (configLembrete !== null && (typeof configLembrete !== 'object' || Array.isArray(configLembrete))) {
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
    // Dois negocios pegando o mesmo endereco ao mesmo tempo: o indice unico
    // barra o segundo.
    if (e?.code === 'P2002') return res.status(409).json({ erro: 'Esse endereço já está em uso. Tente outro.', campos: ['slugPublico'] });
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

// Faturas da assinatura: so a dona ou administrador (vendedor nao ve).
roteador.get('/faturas', requerPapelPrivilegiado, async (req, res) => {
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
