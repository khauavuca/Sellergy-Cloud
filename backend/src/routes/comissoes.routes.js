// Comissoes da equipe: fechamento do mes, vale, pagar.
// Montado em /comissoes (src/index.js). Frente A da fase 2.
//
//   GET    /comissoes?competencia=YYYY-MM            -> fechamento por profissional
//   GET    /comissoes/:especialistaId/detalhe        -> cada atendimento/vale do mes
//   POST   /comissoes/vale                           -> adiantamento (valor negativo)
//   DELETE /comissoes/:id                            -> desfaz vale/ajuste ainda nao pago
//   POST   /comissoes/pagar                          -> marca PAGA, lanca a saida, manda recibo
// A regra de cada pessoa e editada em PUT /especialistas/:id (comissao*).
// Regra de calculo em src/agenda/comissoes.js. So dono/administrador.

const express = require('express');
const prisma = require('../prisma');
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { requerTenant, requerModuloLiberado, requerPapelPrivilegiado } = require('../middlewares/permissoes.middleware');
const { regraTexto, resumirPessoa } = require('../agenda/comissoes');
const { reconciliarEstornos } = require('../agenda/eventosAgenda');
const { competenciaBRT, intervaloCompetencia, round2, brl, digitos } = require('../agenda/utilAgenda');

const roteador = express.Router();
roteador.use(middlewareAutenticacao);
roteador.use(requerTenant);
roteador.use(requerModuloLiberado('FINANCEIRO'));
roteador.use(requerPapelPrivilegiado);

function clienteDe(req, res) {
  const id = req.usuario?.clienteId;
  if (!id) res.status(403).json({ erro: 'Escolha um negócio para ver as comissões.' });
  return id;
}

function lerCompetencia(valor) {
  const c = typeof valor === 'string' && valor ? valor : competenciaBRT();
  return intervaloCompetencia(c) ? c : null;
}

function nomeDoMes(competencia) {
  const [ano, mes] = competencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

roteador.get('/', async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const competencia = lerCompetencia(req.query.competencia);
    if (!competencia) return res.status(422).json({ erro: 'Mês inválido.', campos: ['competencia'] });
    await reconciliarEstornos({ clienteId }).catch((e) => console.error('[comissoes] reconciliar', e?.message));

    const [especialistas, comissoes] = await Promise.all([
      prisma.especialista.findMany({
        where: { clienteId },
        select: {
          id: true, nome: true, ativo: true, comissaoServicoPct: true, comissaoProdutoPct: true, comissaoFixa: true,
          usuario: { select: { telefone: true } },
        },
        orderBy: { nome: 'asc' },
      }),
      prisma.comissao.findMany({ where: { clienteId, competencia }, orderBy: { criadoEm: 'asc' } }),
    ]);

    const porPessoa = new Map();
    for (const c of comissoes) {
      if (!porPessoa.has(c.especialistaId)) porPessoa.set(c.especialistaId, []);
      porPessoa.get(c.especialistaId).push(c);
    }
    const pessoas = especialistas
      .filter((e) => e.ativo || porPessoa.has(e.id))
      .map((e) => {
        const resumo = resumirPessoa(porPessoa.get(e.id) || []);
        return {
          id: e.id, nome: e.nome, ativo: e.ativo,
          regra: { comissaoServicoPct: e.comissaoServicoPct, comissaoProdutoPct: e.comissaoProdutoPct, comissaoFixa: e.comissaoFixa, texto: regraTexto(e) },
          telefone: e.usuario?.telefone || null,
          ...resumo,
          situacao: resumo.aPagar !== 0 ? 'A_PAGAR' : (resumo.pago !== 0 ? 'PAGA' : 'SEM_MOVIMENTO'),
        };
      });

    const soma = (campo) => round2(pessoas.reduce((s, p) => s + p[campo], 0));
    const baseServicos = soma('baseServicos');
    const total = soma('total');
    res.json({
      competencia,
      mes: nomeDoMes(competencia),
      totais: {
        total, pago: soma('pago'), aPagar: soma('aPagar'), baseServicos,
        pctDoFaturamento: baseServicos > 0 ? Math.round((total / baseServicos) * 1000) / 10 : null,
        pessoasPagas: pessoas.filter((p) => p.situacao === 'PAGA').length,
        pessoasComMovimento: pessoas.filter((p) => p.situacao !== 'SEM_MOVIMENTO').length,
      },
      pessoas,
    });
  } catch (e) {
    console.error('[comissoes/listar]', e);
    res.status(500).json({ erro: 'Erro ao carregar as comissões.' });
  }
});

roteador.get('/:especialistaId/detalhe', async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const competencia = lerCompetencia(req.query.competencia);
    if (!competencia) return res.status(422).json({ erro: 'Mês inválido.', campos: ['competencia'] });
    const esp = await prisma.especialista.findFirst({ where: { id: req.params.especialistaId, clienteId }, select: { id: true } });
    if (!esp) return res.status(404).json({ erro: 'Profissional não encontrado.' });
    const itens = await prisma.comissao.findMany({
      where: { clienteId, especialistaId: esp.id, competencia }, orderBy: { criadoEm: 'asc' },
    });
    const ids = itens.map((i) => i.agendamentoId).filter(Boolean);
    const ags = ids.length ? await prisma.agendamento.findMany({ where: { id: { in: ids }, clienteId }, select: { id: true, nomeCliente: true, data: true } }) : [];
    const agPorId = new Map(ags.map((a) => [a.id, a]));
    res.json(itens.map((i) => ({
      id: i.id, tipo: i.tipo, descricao: i.descricao, base: i.base, valor: i.valor, status: i.status,
      criadoEm: i.criadoEm, pagaEm: i.pagaEm,
      atendimento: i.agendamentoId && agPorId.get(i.agendamentoId)
        ? { cliente: agPorId.get(i.agendamentoId).nomeCliente, data: agPorId.get(i.agendamentoId).data }
        : null,
    })));
  } catch (e) {
    console.error('[comissoes/detalhe]', e);
    res.status(500).json({ erro: 'Erro ao carregar o detalhe.' });
  }
});

roteador.post('/vale', async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const { especialistaId, valor, descricao } = req.body || {};
    const competencia = lerCompetencia(req.body?.competencia);
    const campos = [];
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0 || v > 1000000) campos.push('valor');
    if (!competencia) campos.push('competencia');
    const esp = typeof especialistaId === 'string' ? await prisma.especialista.findFirst({ where: { id: especialistaId, clienteId }, select: { id: true } }) : null;
    if (!esp) campos.push('especialistaId');
    if (campos.length) return res.status(422).json({ erro: 'Confira os campos destacados.', campos });
    const texto = typeof descricao === 'string' && descricao.trim()
      ? descricao.trim().slice(0, 120)
      : `Vale adiantado em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}`;
    const vale = await prisma.comissao.create({
      data: { clienteId, especialistaId: esp.id, tipo: 'VALE', descricao: texto, base: 0, valor: -round2(v), competencia, status: 'A_PAGAR' },
    });
    res.status(201).json(vale);
  } catch (e) {
    console.error('[comissoes/vale]', e);
    res.status(500).json({ erro: 'Erro ao lançar o vale.' });
  }
});

roteador.delete('/:id', async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const r = await prisma.comissao.updateMany({
      where: { id: req.params.id, clienteId, tipo: { in: ['VALE', 'AJUSTE'] }, status: 'A_PAGAR' },
      data: { status: 'CANCELADA' },
    });
    if (!r.count) return res.status(409).json({ erro: 'Só dá pra desfazer vale ou ajuste que ainda não foi pago.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[comissoes/desfazer]', e);
    res.status(500).json({ erro: 'Erro ao desfazer.' });
  }
});

roteador.post('/pagar', async (req, res) => {
  try {
    const clienteId = clienteDe(req, res);
    if (!clienteId) return;
    const { especialistaId, lancarFinanceiro = true, enviarRecibo = false, telefone, metodoPagamento = 'PIX' } = req.body || {};
    const competencia = lerCompetencia(req.body?.competencia);
    if (!competencia) return res.status(422).json({ erro: 'Mês inválido.', campos: ['competencia'] });
    const esp = typeof especialistaId === 'string'
      ? await prisma.especialista.findFirst({ where: { id: especialistaId, clienteId }, select: { id: true, nome: true, usuario: { select: { telefone: true } } } })
      : null;
    if (!esp) return res.status(422).json({ erro: 'Profissional inválido.', campos: ['especialistaId'] });
    const telInformado = digitos(telefone);
    if (telefone && (telInformado.length < 10 || telInformado.length > 13)) return res.status(422).json({ erro: 'WhatsApp inválido.', campos: ['telefone'] });
    const metodo = ['PIX', 'DINHEIRO', 'TRANSFERENCIA'].includes(metodoPagamento) ? metodoPagamento : 'PIX';

    const agora = new Date();
    const resultado = await prisma.$transaction(async (tx) => {
      const abertas = await tx.comissao.findMany({ where: { clienteId, especialistaId: esp.id, competencia, status: 'A_PAGAR' } });
      if (!abertas.length) return null;
      const r = await tx.comissao.updateMany({ where: { id: { in: abertas.map((a) => a.id) }, status: 'A_PAGAR' }, data: { status: 'PAGA', pagaEm: agora } });
      if (r.count !== abertas.length) throw Object.assign(new Error('Outra pessoa pagou ao mesmo tempo. Atualize a tela.'), { status: 409 });
      const total = round2(abertas.reduce((s, a) => s + a.valor, 0));
      let lancamento = null;
      if (lancarFinanceiro === true && total > 0) {
        lancamento = await tx.lancamentoFinanceiro.create({
          data: {
            clienteId, descricao: `Comissão ${esp.nome} (${nomeDoMes(competencia)})`, valor: total,
            tipo: 'DESPESA', status: 'PAGO', metodoPagamento: metodo, dataVencimento: agora, dataPagamento: agora,
          },
        });
        await tx.historicoLancamento.create({
          data: {
            lancamentoId: lancamento.id, acao: 'CRIADO', usuarioId: req.usuario.id || null, usuarioNome: req.usuario.nome || null,
            alteracoes: { snapshot: { descricao: lancamento.descricao, valor: total, tipo: 'DESPESA', origem: 'COMISSAO', competencia } },
          },
        });
      }
      return { abertas, total, lancamento };
    });
    if (!resultado) return res.status(409).json({ erro: 'Não há nada a pagar pra essa pessoa nesse mês.' });

    let recibo = null;
    if (enviarRecibo === true) {
      const para = telInformado || digitos(esp.usuario?.telefone);
      if (!para) {
        recibo = { enviado: false, motivo: 'Sem WhatsApp cadastrado pra essa pessoa.' };
      } else {
        const resumo = resumirPessoa(resultado.abertas);
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, brandNome: true } });
        const linhas = [
          ...resumo.linhas.map((l) => `• ${l.quantidade}× ${l.titulo}: ${brl(l.valor)}`),
          ...resumo.vales.map((v) => `• ${v.descricao}: ${brl(v.valor)}`),
          ...resumo.ajustes.map((v) => `• ${v.descricao}: ${brl(v.valor)}`),
        ];
        const texto = `Recibo de comissão — ${cliente?.brandNome || cliente?.nome || ''}\n${esp.nome}, ${nomeDoMes(competencia)}\n\n${linhas.join('\n')}\n\nTotal pago: ${brl(resultado.total)}\nPago em ${agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`;
        try {
          const { enviarMensagemTenant } = require('../services/mensagemTenant');
          const r = await enviarMensagemTenant({ clienteId, para, texto, tipo: 'conversa' });
          recibo = r?.ok ? { enviado: true } : { enviado: false, motivo: 'Não foi possível enviar pelo WhatsApp.' };
        } catch (e) {
          console.error('[comissoes/recibo]', e?.message);
          recibo = { enviado: false, motivo: 'Não foi possível enviar pelo WhatsApp.' };
        }
      }
    }

    res.json({ ok: true, total: resultado.total, itens: resultado.abertas.length, lancamentoId: resultado.lancamento?.id || null, recibo });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ erro: e.message });
    console.error('[comissoes/pagar]', e);
    res.status(500).json({ erro: 'Erro ao pagar a comissão.' });
  }
});

module.exports = roteador;
