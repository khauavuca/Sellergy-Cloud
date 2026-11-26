const prisma = require('../prisma');
const crypto = require('crypto');
const { lockClienteAdvisory } = require('../utils/locks');
const R = require('../financeiro/regras');

const TIPOS_VALIDOS = ['RECEITA', 'DESPESA'];
const STATUS_FILTRO = ['PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO'];
const METODOS_PAGAMENTO = ['PIX', 'DINHEIRO', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'BOLETO', 'TRANSFERENCIA'];
const USOS = ['SERVICO', 'PRODUTO', 'CAIXA', 'DESPESA'];
const VALOR_MAX = 10_000_000;

// Erro de regra (4xx) lancado de dentro de transacao.
function erroRegra(status, erro, extra = {}) {
  return Object.assign(new Error(erro), { status, extra });
}

function responderErro(res, e, rotulo, msg500) {
  if (e?.status && e.status < 500) {
    return res.status(e.status).json({ erro: e.message, ...(e.extra || {}) });
  }
  console.error(rotulo, e);
  return res.status(500).json({ erro: msg500 });
}

async function buscarLancamentoDoCliente(id, clienteId) {
  if (!clienteId || typeof id !== 'string') return null;
  return prisma.lancamentoFinanceiro.findFirst({
    where: { id, clienteId },
    include: { lead: true },
  });
}

// =====================================================================
// PROTECAO DE INTEGRIDADE FINANCEIRA
// =====================================================================
// Lancamento gerado por venda (vendaId !== null) NAO pode ser editado,
// excluido ou cancelado pelo modulo Financeiro. Pra reverter, o usuario
// precisa cancelar a VENDA inteira (POST /vendas/:id/cancelar).
const MSG_BLOQUEIO_VENDA = 'Este lançamento foi gerado por uma venda. Para editar ou cancelar, vá em Vendas e cancele a venda — isso desfaz o estoque e este lançamento juntos.';

function bloquearSeVendaVinculada(lancamento) {
  if (lancamento && lancamento.vendaId) return { erro: MSG_BLOQUEIO_VENDA, status: 422 };
  return null;
}

// 'ATRASADO' nao e persistido — e derivado: PENDENTE + vencimento antes de hoje (Brasilia).
function calcularStatusEfetivo(lanc) {
  if (!lanc) return null;
  if (lanc.status !== 'PENDENTE') return lanc.status;
  return R.diaBRT(lanc.dataVencimento) < R.diaBRT(new Date()) ? 'ATRASADO' : 'PENDENTE';
}

// Mes fechado: PAGO em mes anterior ao atual (Brasilia) e imutavel.
const ehMesFechadoImutavel = (lanc) => R.ehMesFechado(lanc);
const MSG_BLOQUEIO_MES_FECHADO = 'Lançamento de mês fechado (pago em mês anterior) não pode ser alterado, para preservar os relatórios. Para ajustar, crie um lançamento compensatório no mês atual.';

// Inicio do dia de hoje em Brasilia (instante UTC).
function inicioHojeBRT() {
  return R.lerLimite(R.diaBRT(new Date()), 'inicio', 'Hoje').data;
}

// =====================================================================
// AUDITORIA — log de mudancas em lancamentos
// =====================================================================
const cacheNomeUsuario = new Map();

async function obterNomeUsuario(usuarioId) {
  if (!usuarioId) return null;
  if (cacheNomeUsuario.has(usuarioId)) return cacheNomeUsuario.get(usuarioId);
  try {
    const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } });
    const nome = u?.nome || null;
    cacheNomeUsuario.set(usuarioId, nome);
    if (cacheNomeUsuario.size > 200) cacheNomeUsuario.delete(cacheNomeUsuario.keys().next().value);
    return nome;
  } catch {
    return null;
  }
}

// Best-effort: nunca quebra a operacao principal se falhar logar.
async function logHistoricoLancamento({ lancamentoId, acao, alteracoes = null, req }) {
  try {
    const usuarioId = req?.usuario?.id || null;
    const usuarioNome = await obterNomeUsuario(usuarioId);
    await prisma.historicoLancamento.create({ data: { lancamentoId, acao, alteracoes, usuarioId, usuarioNome } });
  } catch (e) {
    console.error('[financeiro/historico] falha ao logar', e?.message);
  }
}

function calcularAlteracoesLancamento(antes, depois, campos) {
  const diff = {};
  for (const c of campos) {
    if (depois[c] === undefined) continue;
    const a = antes[c] instanceof Date ? antes[c].toISOString() : antes[c];
    const b = depois[c] instanceof Date ? depois[c].toISOString() : depois[c];
    if (a !== b) diff[c] = { de: a ?? null, para: b ?? null };
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

// Confere categoria do mesmo negocio (e do tipo do lancamento, quando informado).
async function conferirCategoria(categoriaId, clienteId, tipo) {
  if (typeof categoriaId !== 'string') return { status: 422, erro: 'Categoria inválida.' };
  const cat = await prisma.categoriaFinanceira.findFirst({ where: { id: categoriaId, clienteId } });
  if (!cat) return { status: 404, erro: 'Categoria não encontrada.' };
  if (tipo && cat.tipo !== tipo) {
    return { status: 422, erro: `A categoria "${cat.nome}" é de ${cat.tipo === 'RECEITA' ? 'receita' : 'despesa'}; o lançamento é de ${tipo === 'RECEITA' ? 'receita' : 'despesa'}.` };
  }
  return { ok: true, cat };
}

async function conferirLead(leadId, clienteId) {
  if (typeof leadId !== 'string') return { status: 422, erro: 'Cliente (lead) inválido.' };
  const lead = await prisma.lead.findFirst({ where: { id: leadId, clienteId }, select: { id: true } });
  if (!lead) return { status: 404, erro: 'Cliente (lead) não encontrado.' };
  return { ok: true };
}

// Esconde lead/venda que nao sejam do mesmo negocio (dados antigos forjados).
function limparVinculos(l) {
  const saida = { ...l };
  if (saida.lead && saida.lead.clienteId !== l.clienteId) { saida.lead = null; saida.leadId = null; }
  if (saida.venda && saida.venda.clienteId !== l.clienteId) { saida.venda = null; saida.vendaId = null; }
  if (saida.lead) delete saida.lead.clienteId;
  return saida;
}

function lerChaveRepeticao(req) {
  const bruto = req.get?.('Idempotency-Key') || req.body?.chaveRepeticao;
  if (typeof bruto !== 'string') return null;
  const t = bruto.trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(t) ? t : null;
}

class FinanceiroController {

  // Lançamentos
  async listarLancamentos(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const { tipo, status, buscar } = req.query;

      const paginaNum = R.lerInteiro(req.query.pagina ?? 1, { min: 1, max: 100000 }).valor || 1;
      const limiteNum = Math.min(100, R.lerInteiro(req.query.limite ?? 50, { min: 1, max: 1000 }).valor || 50);

      if (tipo && !TIPOS_VALIDOS.includes(tipo)) return res.status(422).json({ erro: 'Tipo inválido. Use RECEITA ou DESPESA.' });
      if (status && !STATUS_FILTRO.includes(status)) return res.status(422).json({ erro: 'Situação inválida.' });
      if (buscar !== undefined && (typeof buscar !== 'string' || buscar.length > 120)) {
        return res.status(422).json({ erro: 'Busca inválida (máximo 120 caracteres).' });
      }
      const periodo = R.lerPeriodo({ inicio: req.query.inicio, fim: req.query.fim });
      if (!periodo.ok) return res.status(422).json({ erro: periodo.erro });

      // ATRASADO e virtual: PENDENTE + vencimento antes de hoje (Brasilia).
      const hoje = inicioHojeBRT();
      let statusFiltro = status || undefined;
      const venc = {};
      if (periodo.inicio) venc.gte = periodo.inicio;
      if (periodo.fim) venc.lte = periodo.fim;
      if (status === 'ATRASADO') {
        statusFiltro = 'PENDENTE';
        venc.lt = hoje;
      } else if (status === 'PENDENTE') {
        venc.gte = venc.gte && venc.gte > hoje ? venc.gte : hoje;
      }

      const onde = {
        clienteId,
        tipo: tipo || undefined,
        status: statusFiltro,
        descricao: buscar ? { contains: buscar, mode: 'insensitive' } : undefined,
        ...(Object.keys(venc).length ? { dataVencimento: venc } : {}),
      };

      const [lancamentos, total] = await prisma.$transaction([
        prisma.lancamentoFinanceiro.findMany({
          where: onde,
          include: {
            categoria: true,
            lead: { select: { nome: true, telefone: true, clienteId: true } },
            venda: true,
          },
          orderBy: { dataVencimento: 'desc' },
          skip: (paginaNum - 1) * limiteNum,
          take: limiteNum,
        }),
        prisma.lancamentoFinanceiro.count({ where: onde }),
      ]);

      const agora = new Date();
      const dados = lancamentos.map((bruto) => {
        const l = limparVinculos(bruto);
        const efetivo = calcularStatusEfetivo(l);
        const diasAtraso = efetivo === 'ATRASADO'
          ? Math.max(1, Math.floor((agora - new Date(l.dataVencimento)) / R.DIA_MS))
          : 0;
        return {
          ...l,
          estaAtrasado: diasAtraso > 0,
          diasAtraso,
          statusEfetivo: efetivo,
          imutavel: ehMesFechadoImutavel(l),
          valorAtualizado: diasAtraso > 0 ? Number((l.valor * (1 + (diasAtraso * 0.00033) + 0.02)).toFixed(2)) : l.valor,
        };
      });

      res.json({
        dados,
        paginacao: { total, pagina: paginaNum, limite: limiteNum, paginas: Math.ceil(total / limiteNum) },
      });
    } catch (error) {
      console.error('[listaLancamentos]', error);
      res.status(500).json({ erro: 'Erro ao listar lançamentos' });
    }
  }

  async criarLancamento(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const corpo = req.body || {};

      const descricao = R.lerTexto(corpo.descricao, { rotulo: 'Descrição', min: 2, max: 200, obrigatorio: true });
      if (!descricao.ok) return res.status(422).json({ erro: descricao.erro, campos: ['descricao'] });
      const valor = R.lerDinheiro(corpo.valor, { min: 0.01, max: VALOR_MAX });
      if (!valor.ok) return res.status(422).json({ erro: `Valor: ${valor.erro}`, campos: ['valor'] });
      if (!TIPOS_VALIDOS.includes(corpo.tipo)) return res.status(422).json({ erro: 'Tipo inválido. Use RECEITA ou DESPESA.', campos: ['tipo'] });
      const tipo = corpo.tipo;
      const venc = R.lerDataDia(corpo.dataVencimento, 'Data de vencimento');
      if (!venc.ok) return res.status(422).json({ erro: venc.erro, campos: ['dataVencimento'] });

      const status = corpo.status || 'PENDENTE';
      if (status === 'ATRASADO') return res.status(422).json({ erro: '"Atrasado" é calculado automaticamente. Crie como pendente.', campos: ['status'] });
      if (status === 'CANCELADO') return res.status(422).json({ erro: 'Não dá para criar um lançamento já cancelado.', campos: ['status'] });
      if (!['PENDENTE', 'PAGO'].includes(status)) return res.status(422).json({ erro: 'Situação inválida. Use PENDENTE ou PAGO.', campos: ['status'] });

      let dataPagamento = null;
      if (status === 'PAGO') {
        if (corpo.dataPagamento) {
          const dp = R.lerDataDia(corpo.dataPagamento, 'Data de pagamento');
          if (!dp.ok) return res.status(422).json({ erro: dp.erro, campos: ['dataPagamento'] });
          if (dp.data.getTime() > Date.now() + R.DIA_MS) return res.status(422).json({ erro: 'A data de pagamento não pode ser no futuro.', campos: ['dataPagamento'] });
          dataPagamento = dp.data;
        } else {
          dataPagamento = new Date();
        }
      }

      const parcelas = R.lerParcelas(corpo.parcelas);
      if (!parcelas.ok) return res.status(422).json({ erro: parcelas.erro, campos: ['parcelas'] });
      const n = parcelas.valor;
      if (valor.valor < n * 0.01) return res.status(422).json({ erro: 'Valor pequeno demais para tantas parcelas.', campos: ['parcelas'] });

      const produto = R.lerTexto(corpo.produto, { rotulo: 'Produto', max: 200 });
      if (!produto.ok) return res.status(422).json({ erro: produto.erro, campos: ['produto'] });
      const metodoPagamento = corpo.metodoPagamento || null;
      if (metodoPagamento && !METODOS_PAGAMENTO.includes(metodoPagamento)) {
        return res.status(422).json({ erro: 'Forma de pagamento inválida.', campos: ['metodoPagamento'] });
      }

      const categoriaId = corpo.categoriaId || null;
      if (categoriaId) {
        const c = await conferirCategoria(categoriaId, clienteId, tipo);
        if (!c.ok) return res.status(c.status).json({ erro: c.erro, campos: ['categoriaId'] });
      }
      const leadId = corpo.leadId || null;
      if (leadId) {
        const l = await conferirLead(leadId, clienteId);
        if (!l.ok) return res.status(l.status).json({ erro: l.erro, campos: ['leadId'] });
      }
      const vendaId = corpo.vendaId || null;
      if (vendaId) {
        if (typeof vendaId !== 'string') return res.status(422).json({ erro: 'Venda inválida.', campos: ['vendaId'] });
        if (n > 1) return res.status(422).json({ erro: 'Lançamento de venda não pode ser parcelado aqui.', campos: ['parcelas'] });
        if (tipo !== 'RECEITA') return res.status(422).json({ erro: 'Lançamento ligado a venda tem que ser receita.', campos: ['tipo'] });
      }

      const chave = lerChaveRepeticao(req);
      const valores = R.dividirParcelas(valor.valor, n);
      const idAgrupamento = n > 1 ? crypto.randomUUID() : null;

      const resultado = await prisma.$transaction(async (tx) => {
        // Serializa criacoes do mesmo negocio: chave de repeticao e venda
        // vinculada nao podem ser conferidas e gravadas em paralelo.
        await lockClienteAdvisory(tx, clienteId);
        if (chave) {
          const ja = await tx.lancamentoFinanceiro.findFirst({ where: { clienteId, chaveRepeticao: chave } });
          if (ja) return { repetido: ja };
        }
        if (vendaId) {
          const venda = await tx.venda.findFirst({ where: { id: vendaId, clienteId }, select: { id: true } });
          if (!venda) throw erroRegra(404, 'Venda não encontrada.', { campos: ['vendaId'] });
          const jaTem = await tx.lancamentoFinanceiro.findFirst({ where: { vendaId, clienteId }, select: { id: true } });
          if (jaTem) throw erroRegra(409, 'Esta venda já tem lançamento no financeiro.', { campos: ['vendaId'] });
        }
        const criados = [];
        for (let i = 0; i < n; i++) {
          criados.push(await tx.lancamentoFinanceiro.create({
            data: {
              clienteId,
              descricao: n > 1 ? `${descricao.valor} (${i + 1}/${n})` : descricao.valor,
              valor: valores[i],
              tipo,
              dataVencimento: R.vencimentoParcela(venc.data, i),
              status: i === 0 ? status : 'PENDENTE',
              dataPagamento: i === 0 ? dataPagamento : null,
              categoriaId,
              leadId,
              vendaId,
              idAgrupamento,
              produto: produto.valor,
              metodoPagamento,
              chaveRepeticao: i === 0 ? chave : null,
            },
          }));
        }
        return { criados };
      });

      if (resultado.repetido) {
        return res.status(200).json({ ...resultado.repetido, repetido: true });
      }
      for (const l of resultado.criados) {
        await logHistoricoLancamento({
          lancamentoId: l.id,
          acao: 'CRIADO',
          alteracoes: {
            snapshot: {
              descricao: l.descricao, valor: l.valor, tipo: l.tipo,
              dataVencimento: l.dataVencimento?.toISOString(), status: l.status,
              ...(n > 1 ? { parcelas: n, idAgrupamento } : {}),
            },
          },
          req,
        });
      }
      if (n > 1) return res.status(201).json({ mensagem: `${n} parcelas criadas.`, total: valor.valor, idAgrupamento });
      return res.status(201).json(resultado.criados[0]);
    } catch (error) {
      return responderErro(res, error, '[criarLancamento]', 'Erro ao criar lançamento financeiro');
    }
  }

  async editarLancamento(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      const dados = req.body || {};
      const existente = await buscarLancamentoDoCliente(id, clienteId);
      if (!existente) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
      const bloqueio = bloquearSeVendaVinculada(existente);
      if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });
      if (ehMesFechadoImutavel(existente)) {
        return res.status(423).json({ erro: MSG_BLOQUEIO_MES_FECHADO, codigo: 'MES_FECHADO' });
      }
      if (existente.status === 'CANCELADO') {
        return res.status(409).json({ erro: 'Lançamento cancelado não pode ser editado. Reabra antes.' });
      }

      const data = {};
      if (dados.descricao !== undefined) {
        const d = R.lerTexto(dados.descricao, { rotulo: 'Descrição', min: 2, max: 200, obrigatorio: true });
        if (!d.ok) return res.status(422).json({ erro: d.erro, campos: ['descricao'] });
        data.descricao = d.valor;
      }
      if (dados.valor !== undefined) {
        const v = R.lerDinheiro(dados.valor, { min: 0.01, max: VALOR_MAX });
        if (!v.ok) return res.status(422).json({ erro: `Valor: ${v.erro}`, campos: ['valor'] });
        data.valor = v.valor;
      }
      if (dados.tipo !== undefined) {
        if (!TIPOS_VALIDOS.includes(dados.tipo)) return res.status(422).json({ erro: 'Tipo inválido. Use RECEITA ou DESPESA.', campos: ['tipo'] });
        data.tipo = dados.tipo;
      }
      if (dados.dataVencimento !== undefined) {
        const v = R.lerDataDia(dados.dataVencimento, 'Data de vencimento');
        if (!v.ok) return res.status(422).json({ erro: v.erro, campos: ['dataVencimento'] });
        data.dataVencimento = v.data;
      }
      const tipoFinal = data.tipo || existente.tipo;
      if (dados.categoriaId !== undefined) {
        if (dados.categoriaId) {
          const c = await conferirCategoria(dados.categoriaId, clienteId, tipoFinal);
          if (!c.ok) return res.status(c.status).json({ erro: c.erro, campos: ['categoriaId'] });
        }
        data.categoriaId = dados.categoriaId || null;
      } else if (data.tipo && existente.categoriaId) {
        const c = await conferirCategoria(existente.categoriaId, clienteId, tipoFinal);
        if (!c.ok) return res.status(422).json({ erro: `${c.erro} Troque a categoria também.`, campos: ['categoriaId'] });
      }
      if (dados.leadId !== undefined) {
        if (dados.leadId) {
          const l = await conferirLead(dados.leadId, clienteId);
          if (!l.ok) return res.status(l.status).json({ erro: l.erro, campos: ['leadId'] });
        }
        data.leadId = dados.leadId || null;
      }
      // Venda so e vinculada pelo modulo Vendas.
      if (dados.vendaId !== undefined && dados.vendaId !== null && dados.vendaId !== existente.vendaId) {
        return res.status(422).json({ erro: 'Não dá para ligar um lançamento a uma venda pela edição.', campos: ['vendaId'] });
      }
      if (dados.produto !== undefined) {
        const p = R.lerTexto(dados.produto, { rotulo: 'Produto', max: 200 });
        if (!p.ok) return res.status(422).json({ erro: p.erro, campos: ['produto'] });
        data.produto = p.valor;
      }
      if (dados.metodoPagamento !== undefined) {
        if (dados.metodoPagamento && !METODOS_PAGAMENTO.includes(dados.metodoPagamento)) {
          return res.status(422).json({ erro: 'Forma de pagamento inválida.', campos: ['metodoPagamento'] });
        }
        data.metodoPagamento = dados.metodoPagamento || null;
      }

      // Atualizacao condicional: so grava se o lancamento ainda esta como lido.
      const r = await prisma.lancamentoFinanceiro.updateMany({
        where: { id, clienteId, vendaId: null, status: existente.status, atualizadoEm: existente.atualizadoEm },
        data,
      });
      if (r.count !== 1) return res.status(409).json({ erro: 'O lançamento mudou enquanto você editava. Atualize a tela e tente de novo.' });
      const lancamento = await prisma.lancamentoFinanceiro.findFirst({ where: { id, clienteId } });

      const alteracoes = calcularAlteracoesLancamento(existente, data,
        ['descricao', 'valor', 'tipo', 'dataVencimento', 'categoriaId', 'leadId', 'produto', 'metodoPagamento']);
      if (alteracoes) await logHistoricoLancamento({ lancamentoId: id, acao: 'EDITADO', alteracoes, req });
      res.json(lancamento);
    } catch (error) {
      return responderErro(res, error, '[editarLancamento]', 'Erro ao editar lançamento');
    }
  }

  async atualizarStatus(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      const { status, dataPagamento } = req.body || {};
      const existente = await buscarLancamentoDoCliente(id, clienteId);
      if (!existente) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
      const bloqueio = bloquearSeVendaVinculada(existente);
      if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });
      if (ehMesFechadoImutavel(existente)) {
        return res.status(423).json({ erro: MSG_BLOQUEIO_MES_FECHADO, codigo: 'MES_FECHADO' });
      }
      const t = R.validarTransicaoStatus(existente.status, status);
      if (!t.ok) return res.status(422).json({ erro: t.erro });
      if (t.semMudanca) return res.json(existente);

      const data = { status };
      if (status === 'PAGO') {
        if (dataPagamento) {
          const dp = R.lerDataDia(dataPagamento, 'Data de pagamento');
          if (!dp.ok) return res.status(422).json({ erro: dp.erro });
          if (dp.data.getTime() > Date.now() + R.DIA_MS) return res.status(422).json({ erro: 'A data de pagamento não pode ser no futuro.' });
          if (R.dataEmMesFechado(dp.data)) return res.status(422).json({ erro: 'A data de pagamento cai em mês já fechado. Use uma data do mês atual.' });
          data.dataPagamento = dp.data;
        } else {
          data.dataPagamento = new Date();
        }
      } else if (status === 'PENDENTE') {
        // Voltar de pago limpa a data; reabrir cancelado limpa o cancelamento.
        data.dataPagamento = null;
        data.dataCancelamento = null;
        data.motivoCancelamento = null;
      }

      const r = await prisma.lancamentoFinanceiro.updateMany({
        where: { id, clienteId, vendaId: null, status: existente.status },
        data,
      });
      if (r.count !== 1) return res.status(409).json({ erro: 'A situação do lançamento mudou. Atualize a tela.' });
      const lancamento = await prisma.lancamentoFinanceiro.findFirst({ where: { id, clienteId } });
      await logHistoricoLancamento({
        lancamentoId: id,
        acao: 'STATUS_MUDADO',
        alteracoes: { status: { de: existente.status, para: status } },
        req,
      });
      res.json(lancamento);
    } catch (error) {
      return responderErro(res, error, '[atualizarStatus]', 'Erro ao atualizar status');
    }
  }

  async dashboard(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const hoje = inicioHojeBRT();
      const seteDiasAtras = new Date(hoje.getTime() - 7 * R.DIA_MS);

      const [agregados, vencidos, pagasDaSemana, vencidasDaSemana] = await prisma.$transaction([
        prisma.lancamentoFinanceiro.groupBy({
          by: ['tipo', 'status'],
          where: { clienteId },
          _sum: { valor: true },
        }),
        prisma.lancamentoFinanceiro.aggregate({
          where: { clienteId, status: 'PENDENTE', tipo: 'RECEITA', dataVencimento: { lt: hoje } },
          _sum: { valor: true },
        }),
        prisma.lancamentoFinanceiro.count({
          where: { clienteId, tipo: 'RECEITA', status: 'PAGO', dataVencimento: { gte: seteDiasAtras, lt: hoje } },
        }),
        prisma.lancamentoFinanceiro.count({
          where: { clienteId, tipo: 'RECEITA', status: { not: 'CANCELADO' }, dataVencimento: { gte: seteDiasAtras, lt: hoje } },
        }),
      ]);

      // Cancelado nao conta em lugar nenhum; pendente so o que esta PENDENTE.
      const resumo = { receita: 0, despesa: 0, saldo: 0, pendenteReceita: 0, pendenteDespesa: 0 };
      agregados.forEach((a) => {
        const valor = a._sum.valor || 0;
        if (a.status === 'PAGO') {
          if (a.tipo === 'RECEITA') resumo.receita += valor; else resumo.despesa += valor;
        } else if (a.status === 'PENDENTE') {
          if (a.tipo === 'RECEITA') resumo.pendenteReceita += valor; else resumo.pendenteDespesa += valor;
        }
      });

      const saldoEmRisco = vencidos._sum.valor || 0;
      const indiceEficacia = R.indiceEficacia(pagasDaSemana, vencidasDaSemana);
      res.json({
        resumo: { ...resumo, saldo: resumo.receita - resumo.despesa },
        kpis: {
          saldoEmRisco,
          indiceEficacia,
          previsaoRecuperacao: Number((saldoEmRisco * (indiceEficacia / 100)).toFixed(2)),
        },
      });
    } catch (error) {
      console.error('[dashboard]', error);
      res.status(500).json({ erro: 'Erro no painel financeiro' });
    }
  }

  async inadimplencia(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const hoje = new Date();
      const atrasados = await prisma.lancamentoFinanceiro.findMany({
        where: { clienteId, status: 'PENDENTE', dataVencimento: { lt: inicioHojeBRT() }, tipo: 'RECEITA' },
        include: { lead: { select: { id: true, nome: true, telefone: true, clienteId: true } } },
        orderBy: { dataVencimento: 'asc' },
      });

      const dadosEnriquecidos = atrasados.map((bruto) => {
        const l = limparVinculos(bruto);
        const dias = Math.max(1, Math.floor((hoje - new Date(l.dataVencimento)) / R.DIA_MS));
        let risco = 'BAIXO';
        if (dias > 30) risco = 'CRÍTICO'; else if (dias > 7) risco = 'ALTO';
        return {
          ...l,
          aging: dias,
          nivelRisco: risco,
          valorAtualizado: Number((l.valor * (1 + (dias * 0.00033) + 0.02)).toFixed(2)),
          acoesRecomendadas: dias > 7 ? ['NEGOCIACAO', 'COBRANCA_CRITICA'] : ['LEMBRETE_AMIGAVEL', 'PIX_RAPIDO'],
        };
      });

      res.json({
        resumo: { totalAtrasado: dadosEnriquecidos.reduce((a, b) => a + b.valor, 0), quantidade: atrasados.length },
        clientesInadimplentes: dadosEnriquecidos,
      });
    } catch (error) {
      console.error('[inadimplencia]', error);
      res.status(500).json({ erro: 'Erro na inadimplência' });
    }
  }

  // "Adiar": soma N dias inteiros ao vencimento de um lancamento PENDENTE.
  async pausaAmigavel(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      const lancamento = await buscarLancamentoDoCliente(id, clienteId);
      if (!lancamento) return res.status(404).json({ erro: 'Lançamento não encontrado' });
      const bloqueio = bloquearSeVendaVinculada(lancamento);
      if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });
      const v = R.validarAdiamento(lancamento.status, req.body?.dias);
      if (!v.ok) return res.status(v.status).json({ erro: v.erro });

      const novaData = R.somarDias(lancamento.dataVencimento, v.dias);
      const r = await prisma.lancamentoFinanceiro.updateMany({
        where: { id, clienteId, status: 'PENDENTE', vendaId: null, dataVencimento: lancamento.dataVencimento },
        data: { dataVencimento: novaData },
      });
      if (r.count !== 1) return res.status(409).json({ erro: 'O lançamento mudou. Atualize a tela.' });
      await logHistoricoLancamento({
        lancamentoId: id,
        acao: 'ADIADO',
        alteracoes: {
          dataVencimento: { de: lancamento.dataVencimento?.toISOString(), para: novaData.toISOString() },
          dias: v.dias,
        },
        req,
      });
      res.json({ mensagem: 'Vencimento adiado.', novoVencimento: novaData });
    } catch (error) {
      return responderErro(res, error, '[pausaAmigavel]', 'Erro ao adiar o vencimento');
    }
  }

  async cobrarLancamento(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      const lancamento = await buscarLancamentoDoCliente(id, clienteId);
      if (!lancamento) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
      if (!lancamento.lead?.telefone || lancamento.lead.clienteId !== clienteId) {
        return res.status(400).json({ erro: 'Lançamento sem cliente com telefone cadastrado.' });
      }

      const hoje = new Date();
      const vencimento = new Date(lancamento.dataVencimento);
      const diasAtrasoNum = calcularStatusEfetivo(lancamento) === 'ATRASADO'
        ? Math.max(1, Math.floor((hoje - vencimento) / R.DIA_MS)) : 0;

      const variaveis = {
        nome: lancamento.lead.nome || 'cliente',
        valor: Number(lancamento.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        vencimento: vencimento.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        descricao: lancamento.descricao || '',
        dias_atraso: String(diasAtrasoNum),
      };

      const ehAtrasada = diasAtrasoNum > 0;
      const mensagemPadrao = ehAtrasada
        ? `Olá ${variaveis.nome}! Notei que a fatura "${variaveis.descricao}" no valor de ${variaveis.valor}, com vencimento em ${variaveis.vencimento}, está em atraso há ${variaveis.dias_atraso} dia(s). Pode quitar via Pix? Aguardo retorno 🙏`
        : `Olá ${variaveis.nome}! Passando pra lembrar da fatura "${variaveis.descricao}" no valor de ${variaveis.valor}, com vencimento em ${variaveis.vencimento}. Pode pagar via Pix? Qualquer dúvida me avise 🙂`;

      const telefoneLimpo = lancamento.lead.telefone.replace(/\D/g, '');
      const linkBase = `https://wa.me/${telefoneLimpo}`;
      res.json({
        tipo: 'WHATSAPP_ACTION',
        telefone: telefoneLimpo,
        linkBase,
        mensagemPadrao,
        variaveis,
        link: `${linkBase}?text=${encodeURIComponent(mensagemPadrao)}`,
      });
    } catch (error) {
      console.error('[cobrarLancamento]', error);
      res.status(500).json({ erro: 'Erro ao gerar cobrança' });
    }
  }

  async relatorioDRE(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const periodo = R.lerPeriodo({ inicio: req.query.inicio, fim: req.query.fim });
      if (!periodo.ok) return res.status(422).json({ erro: periodo.erro });
      const dataPagamento = {};
      if (periodo.inicio) dataPagamento.gte = periodo.inicio;
      if (periodo.fim) dataPagamento.lte = periodo.fim;
      const lancamentos = await prisma.lancamentoFinanceiro.findMany({
        where: { clienteId, status: 'PAGO', ...(Object.keys(dataPagamento).length ? { dataPagamento } : {}) },
        include: { categoria: true },
      });

      const dre = { receitaBruta: 0, despesasVariaveis: 0, despesasFixas: 0, resultadoLiquido: 0 };
      lancamentos.forEach((l) => {
        const cat = l.categoria?.nome?.toLowerCase() || '';
        if (l.tipo === 'RECEITA') dre.receitaBruta += l.valor;
        else if (l.categoria?.subTipo === 'VARIAVEL' || (!l.categoria?.subTipo && (cat.includes('venda') || cat.includes('imposto')))) dre.despesasVariaveis += l.valor;
        else dre.despesasFixas += l.valor;
      });
      dre.resultadoLiquido = dre.receitaBruta - dre.despesasVariaveis - dre.despesasFixas;
      res.json(dre);
    } catch (error) {
      console.error('[relatorioDRE]', error);
      res.status(500).json({ erro: 'Erro no DRE' });
    }
  }

  // CRUD Categorias
  async listarCategorias(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const where = { clienteId };
      if (req.query.uso) {
        const pedidos = String(req.query.uso).split(',').map((u) => u.trim()).filter((u) => USOS.includes(u));
        if (pedidos.length) where.uso = { in: pedidos };
      }
      const categorias = await prisma.categoriaFinanceira.findMany({ where, orderBy: { nome: 'asc' } });
      res.json(categorias);
    } catch (error) {
      console.error('[listarCategorias]', error);
      res.status(500).json({ erro: 'Erro ao listar categorias' });
    }
  }

  async criarCategoria(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const { tipo, subTipo, uso } = req.body || {};
      const nome = R.lerTexto(req.body?.nome, { rotulo: 'Nome', min: 2, max: 80, obrigatorio: true });
      if (!nome.ok) return res.status(422).json({ erro: nome.erro, campos: ['nome'] });
      if (!TIPOS_VALIDOS.includes(tipo)) return res.status(422).json({ erro: 'Tipo precisa ser RECEITA ou DESPESA.', campos: ['tipo'] });
      if (!USOS.includes(uso)) {
        return res.status(422).json({ erro: 'Selecione onde a categoria será usada (serviço, produto, caixa ou despesa).', campos: ['uso'] });
      }
      if (subTipo != null && subTipo !== '' && subTipo !== 'VARIAVEL' && subTipo !== 'FIXA') {
        return res.status(422).json({ erro: 'Tipo da despesa inválido. Use FIXA ou VARIAVEL.', campos: ['subTipo'] });
      }
      const subTipoFinal = tipo === 'DESPESA' && (subTipo === 'VARIAVEL' || subTipo === 'FIXA') ? subTipo : null;

      const cat = await prisma.$transaction(async (tx) => {
        await lockClienteAdvisory(tx, clienteId);
        const dup = await tx.categoriaFinanceira.findFirst({
          where: { clienteId, tipo, nome: { equals: nome.valor, mode: 'insensitive' } },
          select: { id: true },
        });
        if (dup) throw erroRegra(409, `Já existe uma categoria de ${tipo === 'RECEITA' ? 'receita' : 'despesa'} chamada "${nome.valor}".`, { campos: ['nome'] });
        return tx.categoriaFinanceira.create({ data: { clienteId, nome: nome.valor, tipo, subTipo: subTipoFinal, uso } });
      });
      res.status(201).json(cat);
    } catch (error) {
      return responderErro(res, error, '[criarCategoria]', 'Erro ao criar categoria');
    }
  }

  async editarCategoria(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const { id } = req.params;
      const { nome, tipo, subTipo, uso } = req.body || {};
      const existente = await prisma.categoriaFinanceira.findFirst({ where: { id, clienteId } });
      if (!existente) return res.status(404).json({ erro: 'Categoria não encontrada.' });

      const data = {};
      if (nome !== undefined) {
        const n = R.lerTexto(nome, { rotulo: 'Nome', min: 2, max: 80, obrigatorio: true });
        if (!n.ok) return res.status(422).json({ erro: n.erro, campos: ['nome'] });
        data.nome = n.valor;
      }
      if (tipo !== undefined) {
        if (!TIPOS_VALIDOS.includes(tipo)) return res.status(422).json({ erro: 'Tipo precisa ser RECEITA ou DESPESA.', campos: ['tipo'] });
        data.tipo = tipo;
      }
      if (uso !== undefined) {
        if (!USOS.includes(uso)) return res.status(422).json({ erro: 'Uso inválido.', campos: ['uso'] });
        data.uso = uso;
      }
      if (subTipo !== undefined) {
        if (subTipo === null || subTipo === '') data.subTipo = null;
        else if (subTipo === 'VARIAVEL' || subTipo === 'FIXA') data.subTipo = subTipo;
        else return res.status(422).json({ erro: 'Tipo da despesa inválido. Use FIXA ou VARIAVEL.', campos: ['subTipo'] });
      }
      const tipoFinal = data.tipo || existente.tipo;
      if (tipoFinal === 'RECEITA') data.subTipo = null;

      const cat = await prisma.$transaction(async (tx) => {
        await lockClienteAdvisory(tx, clienteId);
        if (data.tipo && data.tipo !== existente.tipo) {
          const usados = await tx.lancamentoFinanceiro.count({ where: { clienteId, categoriaId: id } });
          if (usados > 0) throw erroRegra(409, `Esta categoria tem ${usados} lançamento(s). Não dá para trocar de receita para despesa (ou o contrário); crie outra categoria.`);
        }
        const nomeFinal = data.nome || existente.nome;
        const dup = await tx.categoriaFinanceira.findFirst({
          where: { clienteId, tipo: tipoFinal, id: { not: id }, nome: { equals: nomeFinal, mode: 'insensitive' } },
          select: { id: true },
        });
        if (dup) throw erroRegra(409, `Já existe outra categoria chamada "${nomeFinal}".`, { campos: ['nome'] });
        return tx.categoriaFinanceira.update({ where: { id }, data });
      });
      res.json(cat);
    } catch (error) {
      return responderErro(res, error, '[editarCategoria]', 'Erro ao editar categoria');
    }
  }

  // Excluir categoria: se estiver em uso, so com `substituirPor` (outra
  // categoria do mesmo tipo) — os vinculos sao trocados na mesma transacao.
  async excluirCategoria(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const { id } = req.params;
      const substituirPor = req.body?.substituirPor || req.query?.substituirPor || null;

      const resultado = await prisma.$transaction(async (tx) => {
        await lockClienteAdvisory(tx, clienteId);
        const cat = await tx.categoriaFinanceira.findFirst({ where: { id, clienteId } });
        if (!cat) throw erroRegra(404, 'Categoria não encontrada.');
        const [lancamentos, produtos, contasPagar] = await Promise.all([
          tx.lancamentoFinanceiro.count({ where: { clienteId, categoriaId: id } }),
          tx.produto.count({ where: { clienteId, categoriaId: id } }),
          tx.contaPagar.count({ where: { clienteId, categoriaId: id } }),
        ]);
        const emUso = lancamentos + produtos + contasPagar > 0;
        if (emUso) {
          if (!substituirPor) {
            const partes = [
              lancamentos && `${lancamentos} lançamento(s)`,
              produtos && `${produtos} produto(s)/serviço(s)`,
              contasPagar && `${contasPagar} conta(s) a pagar`,
            ].filter(Boolean).join(', ');
            throw erroRegra(409, `A categoria "${cat.nome}" está em uso (${partes}). Escolha outra categoria para ficar no lugar dela.`, {
              codigo: 'CATEGORIA_EM_USO', uso: { lancamentos, produtos, contasPagar },
            });
          }
          if (typeof substituirPor !== 'string' || substituirPor === id) throw erroRegra(422, 'Escolha uma categoria diferente para substituir.');
          const nova = await tx.categoriaFinanceira.findFirst({ where: { id: substituirPor, clienteId } });
          if (!nova) throw erroRegra(404, 'Categoria substituta não encontrada.');
          if (nova.tipo !== cat.tipo) throw erroRegra(422, 'A categoria substituta precisa ser do mesmo tipo (receita ou despesa).');
          await tx.lancamentoFinanceiro.updateMany({ where: { clienteId, categoriaId: id }, data: { categoriaId: nova.id } });
          await tx.produto.updateMany({ where: { clienteId, categoriaId: id }, data: { categoriaId: nova.id } });
          await tx.contaPagar.updateMany({ where: { clienteId, categoriaId: id }, data: { categoriaId: nova.id } });
        }
        await tx.categoriaFinanceira.deleteMany({ where: { id, clienteId } });
        return { movidos: { lancamentos, produtos, contasPagar } };
      });
      res.json({ mensagem: 'Excluída', ...resultado });
    } catch (error) {
      return responderErro(res, error, '[excluirCategoria]', 'Erro ao excluir categoria');
    }
  }

  // Saldo atual = saldo esperado do caixa aberto; sem caixa aberto, o valor
  // contado no ultimo fechamento. (Antes devolvia o valor da ultima
  // movimentacao — uma retirada de 1.000 aparecia como "saldo 1000".)
  async saldoAtual(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const { helpers } = require('./CaixaController');
      const aberta = await helpers.buscarSessaoAberta(clienteId);
      if (aberta) {
        const saldo = await helpers.calcularSaldoEsperado(aberta.id);
        return res.json({ saldo: Math.round(saldo * 100) / 100, origem: 'CAIXA_ABERTO', sessaoId: aberta.id });
      }
      const ultima = await prisma.sessaoCaixa.findFirst({
        where: { clienteId, status: 'FECHADA' },
        orderBy: { fechadaEm: 'desc' },
        select: { id: true, saldoFinalReal: true, fechadaEm: true },
      });
      if (ultima) return res.json({ saldo: ultima.saldoFinalReal ?? 0, origem: 'ULTIMO_FECHAMENTO', sessaoId: ultima.id, fechadaEm: ultima.fechadaEm });
      res.json({ saldo: 0, origem: 'SEM_CAIXA' });
    } catch (error) {
      console.error('[saldoAtual]', error);
      res.status(500).json({ erro: 'Erro ao buscar saldo' });
    }
  }

  // Ajuste manual: diferenca (positiva ou negativa) no caixa aberto, com motivo.
  async ajustarSaldo(req, res) {
    try {
      const { clienteId, id: usuarioId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const v = R.lerDinheiro(req.body?.valor, { min: -VALOR_MAX, max: VALOR_MAX });
      if (!v.ok) return res.status(422).json({ erro: `Valor: ${v.erro}`, campos: ['valor'] });
      if (v.valor === 0) return res.status(422).json({ erro: 'O ajuste não pode ser zero.', campos: ['valor'] });
      const motivo = R.lerTexto(req.body?.motivo, { rotulo: 'Motivo', min: 3, max: 500, obrigatorio: true });
      if (!motivo.ok) return res.status(422).json({ erro: motivo.erro, campos: ['motivo'] });
      const usuarioNome = await obterNomeUsuario(usuarioId);

      const novo = await prisma.$transaction(async (tx) => {
        await lockClienteAdvisory(tx, clienteId);
        const sessao = await tx.sessaoCaixa.findFirst({ where: { clienteId, status: 'ABERTA' }, orderBy: { abertaEm: 'desc' } });
        if (!sessao) throw erroRegra(409, 'Abra o caixa antes de ajustar o saldo.', { codigo: 'CAIXA_FECHADO' });
        return tx.saldoHistorico.create({
          data: {
            clienteId, sessaoCaixaId: sessao.id, valor: v.valor, tipo: 'AJUSTE', motivo: motivo.valor,
            usuarioId: usuarioId || null, usuarioNome: usuarioNome || null,
          },
        });
      });
      res.status(201).json(novo);
    } catch (error) {
      return responderErro(res, error, '[ajustarSaldo]', 'Erro ao ajustar saldo');
    }
  }

  async historicoLancamento(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      const existente = await buscarLancamentoDoCliente(id, clienteId);
      if (!existente) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
      const itens = await prisma.historicoLancamento.findMany({ where: { lancamentoId: id }, orderBy: { criadoEm: 'desc' } });
      res.json({ itens, total: itens.length });
    } catch (error) {
      console.error('[historicoLancamento]', error);
      res.status(500).json({ erro: 'Erro ao carregar histórico do lançamento' });
    }
  }

  async saldoHistorico(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const limite = R.lerInteiro(req.query.limite ?? 50, { min: 1, max: 200 }).valor || 50;
      const itens = await prisma.saldoHistorico.findMany({ where: { clienteId }, orderBy: { data: 'desc' }, take: limite });
      res.json({ itens, total: itens.length });
    } catch (error) {
      console.error('[saldoHistorico]', error);
      res.status(500).json({ erro: 'Erro ao listar histórico de saldo' });
    }
  }

  async excluirLancamento(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      const existente = await buscarLancamentoDoCliente(id, clienteId);
      if (!existente) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
      const bloqueio = bloquearSeVendaVinculada(existente);
      if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });
      if (ehMesFechadoImutavel(existente)) {
        return res.status(423).json({ erro: MSG_BLOQUEIO_MES_FECHADO, codigo: 'MES_FECHADO' });
      }
      if (existente.contaPagarId && existente.sessaoCaixaId) {
        return res.status(409).json({ erro: 'Este pagamento saiu do caixa. Para desfazer, lance uma entrada no caixa e cancele o lançamento.' });
      }
      await logHistoricoLancamento({
        lancamentoId: id,
        acao: 'EXCLUIDO',
        alteracoes: {
          snapshot: {
            descricao: existente.descricao, valor: existente.valor, tipo: existente.tipo,
            status: existente.status, dataVencimento: existente.dataVencimento?.toISOString(),
          },
        },
        req,
      });
      const r = await prisma.lancamentoFinanceiro.deleteMany({ where: { id, clienteId, vendaId: null } });
      if (!r.count) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
      res.json({ message: 'Lançamento excluído com sucesso.' });
    } catch (error) {
      return responderErro(res, error, '[excluirLancamento]', 'Erro ao excluir lançamento');
    }
  }

  async cancelarLancamento(req, res) {
    try {
      const { id } = req.params;
      const { clienteId } = req.usuario;
      const existente = await buscarLancamentoDoCliente(id, clienteId);
      if (!existente) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
      const bloqueio = bloquearSeVendaVinculada(existente);
      if (bloqueio) return res.status(bloqueio.status).json({ erro: bloqueio.erro });
      if (ehMesFechadoImutavel(existente)) {
        return res.status(423).json({ erro: MSG_BLOQUEIO_MES_FECHADO, codigo: 'MES_FECHADO' });
      }
      const v = R.validarCancelamento(existente.status, req.body?.motivo);
      if (!v.ok) return res.status(v.status).json({ erro: v.erro });

      const r = await prisma.lancamentoFinanceiro.updateMany({
        where: { id, clienteId, vendaId: null, status: 'PENDENTE' },
        data: { status: 'CANCELADO', dataCancelamento: new Date(), motivoCancelamento: v.motivo },
      });
      if (r.count !== 1) return res.status(409).json({ erro: 'A situação do lançamento mudou. Atualize a tela.' });
      const lancamento = await prisma.lancamentoFinanceiro.findFirst({ where: { id, clienteId } });
      await logHistoricoLancamento({
        lancamentoId: id,
        acao: 'CANCELADO',
        alteracoes: { motivo: v.motivo, statusAnterior: existente.status },
        req,
      });
      res.json(lancamento);
    } catch (error) {
      return responderErro(res, error, '[cancelarLancamento]', 'Erro ao cancelar lançamento');
    }
  }

  async resumo(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      // Mes atual em Brasilia.
      const [ano, mes] = R.diaBRT(new Date()).split('-').map(Number);
      const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
      const p = R.lerPeriodo({
        inicio: `${ano}-${String(mes).padStart(2, '0')}-01`,
        fim: `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
      });

      const agregados = await prisma.lancamentoFinanceiro.groupBy({
        by: ['tipo', 'status'],
        where: { clienteId, dataVencimento: { gte: p.inicio, lte: p.fim } },
        _sum: { valor: true },
      });

      const r = { totalReceitas: 0, totalDespesas: 0, aReceber: 0 };
      agregados.forEach((a) => {
        const v = a._sum.valor || 0;
        if (a.status === 'PAGO') {
          if (a.tipo === 'RECEITA') r.totalReceitas += v; else r.totalDespesas += v;
        } else if (a.status === 'PENDENTE' && a.tipo === 'RECEITA') {
          r.aReceber += v;
        }
      });

      res.json({ ...r, entradas: r.totalReceitas, saidas: r.totalDespesas, saldo: r.totalReceitas - r.totalDespesas });
    } catch (error) {
      console.error('[resumo]', error);
      res.status(500).json({ erro: 'Erro ao buscar resumo financeiro' });
    }
  }

  // Lote: so "marcar como pago", so lancamentos PENDENTES que nao sao de venda.
  async atualizarStatusEmLote(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const { ids, status } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some((i) => typeof i !== 'string')) {
        return res.status(422).json({ erro: 'Selecione de 1 a 500 lançamentos.' });
      }
      if (status !== 'PAGO') {
        return res.status(422).json({ erro: 'Em lote só dá para marcar como pago.' });
      }
      const unicos = [...new Set(ids)];
      const resultado = await prisma.lancamentoFinanceiro.updateMany({
        where: { id: { in: unicos }, clienteId, vendaId: null, status: 'PENDENTE' },
        data: { status: 'PAGO', dataPagamento: new Date() },
      });

      const ignorados = unicos.length - resultado.count;
      res.json({
        mensagem: ignorados > 0
          ? `${resultado.count} lançamento(s) marcado(s) como pago(s). ${ignorados} ignorado(s) — já pagos, cancelados, de venda ou de outro negócio.`
          : 'Lançamentos marcados como pagos.',
        alterados: resultado.count,
        ignorados,
      });
    } catch (error) {
      console.error('[lote/status]', error);
      res.status(500).json({ erro: 'Erro ao atualizar em lote' });
    }
  }

  async excluirGrupo(req, res) {
    try {
      const { clienteId } = req.usuario;
      const { idAgrupamento } = req.params;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      if (!idAgrupamento) return res.status(400).json({ erro: 'Grupo de parcelas inválido.' });
      const resultado = await prisma.lancamentoFinanceiro.deleteMany({
        where: { idAgrupamento, clienteId, status: { not: 'PAGO' }, vendaId: null },
      });
      res.json({ mensagem: 'Parcelas não pagas excluídas.', excluidas: resultado.count, count: resultado.count });
    } catch (error) {
      console.error('[excluirGrupo]', error);
      res.status(500).json({ erro: 'Erro ao excluir grupo' });
    }
  }

  async fluxoCaixa(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: negócio não identificado.' });
      const hoje = inicioHojeBRT();
      const fim = new Date(hoje.getTime() + 31 * R.DIA_MS - 1);
      const lancamentos = await prisma.lancamentoFinanceiro.findMany({
        where: { clienteId, status: { not: 'CANCELADO' }, dataVencimento: { gte: hoje, lte: fim } },
      });
      res.json(lancamentos);
    } catch (error) {
      console.error('[fluxoCaixa]', error);
      res.status(500).json({ erro: 'Erro ao buscar fluxo de caixa' });
    }
  }
}

module.exports = new FinanceiroController();
module.exports.limparVinculos = limparVinculos;
module.exports.lerChaveRepeticao = lerChaveRepeticao;
