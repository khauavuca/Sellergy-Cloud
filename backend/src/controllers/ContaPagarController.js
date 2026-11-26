// =====================================================================
// CONTROLADOR DE CONTAS A PAGAR
// =====================================================================
// CRUD do catalogo de despesas recorrentes/pontuais. Cada ContaPagar e um
// "modelo" — o pagamento real cria um LancamentoFinanceiro DESPESA PAGO
// vinculado (ver pagar()).

const prisma = require('../prisma');
const { lockClienteAdvisory } = require('../utils/locks');
const R = require('../financeiro/regras');
const { helpers: caixa } = require('./CaixaController');

function responderErro(res, e, rotulo, msg500) {
  if (e?.status && e.status < 500) {
    const payload = { erro: e.message };
    if (e.codigo) payload.codigo = e.codigo;
    if (e.extra) Object.assign(payload, e.extra);
    return res.status(e.status).json(payload);
  }
  console.error(rotulo, e);
  return res.status(500).json({ erro: msg500 });
}

async function conferirCategoriaDespesa(categoriaId, clienteId) {
  if (typeof categoriaId !== 'string') return false;
  return !!(await prisma.categoriaFinanceira.findFirst({ where: { id: categoriaId, clienteId, tipo: 'DESPESA' }, select: { id: true } }));
}

class ContaPagarController {

  async listar(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });

      const { ativa } = req.query;
      const where = { clienteId };
      if (ativa === 'true') where.ativa = true;
      else if (ativa === 'false') where.ativa = false;

      const contas = await prisma.contaPagar.findMany({
        where,
        include: {
          categoria: { select: { id: true, nome: true } },
          _count: { select: { pagamentos: true } },
        },
        orderBy: [{ ativa: 'desc' }, { nome: 'asc' }],
      });
      res.json(contas);
    } catch (e) {
      console.error('[contaPagar/listar]', e);
      res.status(500).json({ error: 'Erro ao listar contas a pagar.' });
    }
  }

  async criar(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });

      const corpo = req.body || {};
      const { categoriaId } = corpo;
      const nome = R.lerTexto(corpo.nome, { rotulo: 'Nome', min: 2, max: 120, obrigatorio: true });
      if (!nome.ok) return res.status(422).json({ erro: nome.erro, campos: ['nome'] });
      const v = R.lerDinheiro(corpo.valorPadrao, { min: 0, max: 10_000_000 });
      if (!v.ok) return res.status(422).json({ erro: `Valor padrão: ${v.erro}`, campos: ['valorPadrao'] });
      const valor = v.valor;
      const ag = R.validarAgendaConta(corpo);
      if (!ag.ok) return res.status(422).json({ erro: ag.erro, campos: [ag.campo] });
      const per = ag.valores.periodicidade;
      const dia = ag.valores.diaVencimento ?? null;
      const mes = per === 'ANUAL' ? (ag.valores.mesVencimento ?? null) : null;
      const obs = R.lerTexto(corpo.observacoes, { rotulo: 'Observações', max: 2000 });
      if (!obs.ok) return res.status(422).json({ erro: obs.erro, campos: ['observacoes'] });

      if (categoriaId && !(await conferirCategoriaDespesa(categoriaId, clienteId))) {
        return res.status(422).json({ erro: 'Categoria inválida (tem que ser uma categoria de despesa sua).', campos: ['categoriaId'] });
      }

      const conta = await prisma.contaPagar.create({
        data: {
          clienteId,
          nome: nome.valor,
          valorPadrao: valor,
          categoriaId: categoriaId || null,
          periodicidade: per,
          diaVencimento: dia,
          mesVencimento: mes,
          observacoes: obs.valor,
          ativa: true,
        },
        include: { categoria: { select: { id: true, nome: true } } },
      });
      res.status(201).json(conta);
    } catch (e) {
      return responderErro(res, e, '[contaPagar/criar]', 'Erro ao criar conta a pagar.');
    }
  }

  async editar(req, res) {
    try {
      const { clienteId } = req.usuario;
      const { id } = req.params;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });

      const existente = await prisma.contaPagar.findFirst({ where: { id, clienteId } });
      if (!existente) return res.status(404).json({ error: 'Conta a pagar não encontrada.' });

      const { nome, valorPadrao, categoriaId, observacoes, ativa } = req.body || {};
      const data = {};
      if (nome !== undefined) {
        const n = R.lerTexto(nome, { rotulo: 'Nome', min: 2, max: 120, obrigatorio: true });
        if (!n.ok) return res.status(422).json({ erro: n.erro, campos: ['nome'] });
        data.nome = n.valor;
      }
      if (valorPadrao !== undefined) {
        const v = R.lerDinheiro(valorPadrao, { min: 0, max: 10_000_000 });
        if (!v.ok) return res.status(422).json({ erro: `Valor padrão: ${v.erro}`, campos: ['valorPadrao'] });
        data.valorPadrao = v.valor;
      }
      if (categoriaId !== undefined) {
        if (categoriaId && !(await conferirCategoriaDespesa(categoriaId, clienteId))) {
          return res.status(422).json({ erro: 'Categoria inválida (tem que ser uma categoria de despesa sua).', campos: ['categoriaId'] });
        }
        data.categoriaId = categoriaId || null;
      }
      const ag = R.validarAgendaConta(req.body || {}, { parcial: true });
      if (!ag.ok) return res.status(422).json({ erro: ag.erro, campos: [ag.campo] });
      Object.assign(data, ag.valores);
      const perFinal = data.periodicidade || existente.periodicidade;
      if (perFinal !== 'ANUAL' && (data.periodicidade !== undefined || data.mesVencimento !== undefined)) data.mesVencimento = null;
      if (observacoes !== undefined) {
        const o = R.lerTexto(observacoes, { rotulo: 'Observações', max: 2000 });
        if (!o.ok) return res.status(422).json({ erro: o.erro, campos: ['observacoes'] });
        data.observacoes = o.valor;
      }
      if (ativa !== undefined) {
        if (typeof ativa !== 'boolean') return res.status(422).json({ erro: 'Campo "ativa" inválido.', campos: ['ativa'] });
        data.ativa = ativa;
      }

      const conta = await prisma.contaPagar.update({
        where: { id },
        data,
        include: { categoria: { select: { id: true, nome: true } } },
      });
      res.json(conta);
    } catch (e) {
      return responderErro(res, e, '[contaPagar/editar]', 'Erro ao editar conta a pagar.');
    }
  }

  // DELETE: so permite se NUNCA foi paga. Senao, o usuario deve usar ativa=false
  // (preserva historico de pagamentos via LancamentoFinanceiro.contaPagarId).
  async excluir(req, res) {
    try {
      const { clienteId } = req.usuario;
      const { id } = req.params;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });

      const conta = await prisma.contaPagar.findFirst({
        where: { id, clienteId },
        include: { _count: { select: { pagamentos: true } } },
      });
      if (!conta) return res.status(404).json({ error: 'Conta a pagar não encontrada.' });
      if (conta._count.pagamentos > 0) {
        return res.status(409).json({
          error: 'Não dá pra excluir uma conta com pagamentos registrados. Desative em vez de excluir.',
          codigo: 'TEM_PAGAMENTOS',
        });
      }
      await prisma.contaPagar.deleteMany({ where: { id, clienteId } });
      res.json({ ok: true });
    } catch (e) {
      console.error('[contaPagar/excluir]', e);
      res.status(500).json({ error: 'Erro ao excluir conta a pagar.' });
    }
  }

  // POST /contas-pagar/:id/pagar — { valor, sessaoCaixaId?, motivo?, dataVencimento? }
  //
  // Marca a conta como paga: cria 1 LancamentoFinanceiro DESPESA PAGO vinculado
  // a esta ContaPagar. Se sessaoCaixaId vier OU houver sessao aberta, cria
  // TAMBEM 1 SaldoHistorico SANGRIA (sai do caixa fisico).
  //
  // Tudo numa transacao + advisory lock pelo clienteId (evita race com cron
  // do caixa fechando sessao no meio).
  async pagar(req, res) {
    try {
      const { clienteId, id: usuarioId } = req.usuario;
      const { id } = req.params;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado.' });

      const corpo = req.body || {};
      const v = R.lerDinheiro(corpo.valor, { min: 0.01, max: 10_000_000 });
      if (!v.ok) return res.status(422).json({ erro: `Valor: ${v.erro}`, campos: ['valor'] });
      const valor = v.valor;
      const m = R.lerTexto(corpo.motivo, { rotulo: 'Observação', max: 500 });
      if (!m.ok) return res.status(422).json({ erro: m.erro, campos: ['motivo'] });
      const motivo = m.valor || '';
      let dataVencimento = new Date();
      if (corpo.dataVencimento) {
        const dv = R.lerDataDia(corpo.dataVencimento, 'Data de vencimento');
        if (!dv.ok) return res.status(422).json({ erro: dv.erro, campos: ['dataVencimento'] });
        dataVencimento = dv.data;
      }
      const confirmarSaldoNegativo = corpo.confirmarSaldoNegativo === true;
      // Flag explicita: se false, paga apenas como lancamento (nao tira do caixa).
      // Util quando o usuario pagou direto do banco (boleto, PIX) sem mexer no caixa.
      const tirarDoCaixa = corpo.tirarDoCaixa !== false;

      const conta = await prisma.contaPagar.findFirst({
        where: { id, clienteId },
        include: { categoria: true },
      });
      if (!conta) return res.status(404).json({ erro: 'Conta a pagar não encontrada.' });
      if (!conta.ativa) return res.status(409).json({ erro: 'Esta conta está desativada. Reative antes de pagar.', codigo: 'CONTA_INATIVA' });

      const usuarioNome = usuarioId ? (await prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { nome: true },
      }))?.nome : null;

      const resultado = await prisma.$transaction(async (tx) => {
        await lockClienteAdvisory(tx, clienteId);

        // Se tirarDoCaixa, busca sessao aberta. Se nao tem, erro 409.
        let sessao = null;
        if (tirarDoCaixa) {
          sessao = await tx.sessaoCaixa.findFirst({
            where: { clienteId, status: 'ABERTA' },
            orderBy: { abertaEm: 'desc' },
          });
          if (!sessao) {
            throw Object.assign(new Error('Abra o caixa antes de pagar pela retirada de dinheiro.'), {
              status: 409,
              codigo: 'CAIXA_FECHADO',
            });
          }
          const saldo = await caixa.calcularSaldoEsperado(sessao.id, tx);
          const chk = R.checarRetirada(valor, saldo, confirmarSaldoNegativo);
          if (!chk.ok) {
            throw Object.assign(new Error(chk.erro), { status: 422, codigo: chk.codigo, extra: { saldoEsperado: saldo, saldoDepois: chk.saldoDepois } });
          }
        }
        // A conta pode ter sido desativada entre a leitura e o lock.
        const aindaAtiva = await tx.contaPagar.findFirst({ where: { id: conta.id, clienteId, ativa: true }, select: { id: true } });
        if (!aindaAtiva) throw Object.assign(new Error('Esta conta está desativada. Reative antes de pagar.'), { status: 409, codigo: 'CONTA_INATIVA' });

        const descricao = `${conta.nome}${motivo ? ` — ${motivo}` : ''}`;

        // 1. Lancamento financeiro DESPESA PAGO vinculado a conta
        const lanc = await tx.lancamentoFinanceiro.create({
          data: {
            clienteId,
            categoriaId: conta.categoriaId,
            contaPagarId: conta.id,
            descricao,
            valor,
            tipo: 'DESPESA',
            status: 'PAGO',
            dataVencimento,
            dataPagamento: new Date(),
            sessaoCaixaId: sessao?.id || null,
          },
        });

        // 2. Se tirar do caixa, cria SaldoHistorico SANGRIA vinculada
        let saldoHist = null;
        if (sessao) {
          saldoHist = await tx.saldoHistorico.create({
            data: {
              clienteId,
              sessaoCaixaId: sessao.id,
              valor,
              tipo: 'SANGRIA',
              motivo: `Pagamento: ${conta.nome}${motivo ? ` (${motivo})` : ''}`,
              usuarioId: usuarioId || null,
              usuarioNome: usuarioNome || null,
            },
          });
        }

        return { lancamento: lanc, saldoHistorico: saldoHist };
      });

      res.status(201).json(resultado);
    } catch (e) {
      return responderErro(res, e, '[contaPagar/pagar]', 'Erro ao pagar conta.');
    }
  }
}

module.exports = new ContaPagarController();
