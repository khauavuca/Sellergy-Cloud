const prisma = require('../prisma');
const { paraNumero, lerDinheiro, lerInteiro } = require('../utils/numero');

// Tipos aceitos na movimentacao MANUAL. VENDA fica de fora: venda de verdade
// passa por /vendas (numero, caixa, cupom, comissao, cancelamento). Uma
// "venda" pelo estoque lancava receita sem venda nem caixa.
const TIPOS_MANUAIS = ['AJUSTE', 'COMPRA_FORNECEDOR', 'DEVOLUCAO', 'RESERVA'];
// Tipos que so podem tirar (saida) ou so podem pôr (entrada) no estoque.
const SO_ENTRADA = ['COMPRA_FORNECEDOR', 'DEVOLUCAO'];
const SO_SAIDA = ['RESERVA'];
const MAX_QTD_MOV = 100000;
const MAX_ESTOQUE = 1000000;
const MAX_PRECO = 1000000;
const MAX_MOTIVO = 500;
const MAX_AJUSTES_LOTE = 500;

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (v) => typeof v === 'string' && RE_UUID.test(v);
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Erro de entrada/regra do estoque (vira 4xx com mensagem propria). */
class ErroEstoque extends Error {
  constructor(mensagem, status = 422, campos) {
    super(mensagem);
    this.status = status;
    if (campos) this.campos = campos;
  }
}

function responderErro(res, e, rotulo) {
  if (e instanceof ErroEstoque) {
    return res.status(e.status).json({ erro: e.message, ...(e.campos ? { campos: e.campos } : {}) });
  }
  console.error(`[EstoqueController.${rotulo}]`, e);
  // Texto generico: nunca devolve a mensagem do Prisma.
  return res.status(500).json({ erro: 'Erro ao processar o estoque.' });
}

/**
 * Valida o corpo de /estoque/movimentar. PURA (sem banco).
 * @returns {{dados:Object}|{erro:string, campos:string[], status?:number}}
 */
function validarMovimentacao(body) {
  const b = body || {};
  if (!ehUuid(b.variacaoId)) return { erro: 'Produto não encontrado.', campos: ['variacaoId'], status: 404 };
  if (b.tipo === 'VENDA') {
    return { erro: 'Venda não se registra pelo estoque. Use "Registrar venda" na tela de Vendas (ela baixa o estoque e lança no caixa).', campos: ['tipo'] };
  }
  if (!TIPOS_MANUAIS.includes(b.tipo)) return { erro: 'Tipo de movimentação inválido.', campos: ['tipo'] };
  const q = lerInteiro(b.quantidade, { min: -MAX_QTD_MOV, max: MAX_QTD_MOV });
  if (!q.ok) return { erro: `Quantidade inválida: ${q.erro}`, campos: ['quantidade'] };
  if (q.valor === 0) return { erro: 'A quantidade não pode ser zero.', campos: ['quantidade'] };
  if (SO_ENTRADA.includes(b.tipo) && q.valor < 0) return { erro: 'Esse tipo de movimentação só aceita entrada (quantidade positiva).', campos: ['quantidade'] };
  if (SO_SAIDA.includes(b.tipo) && q.valor > 0) return { erro: 'Reserva só tira do estoque (quantidade negativa).', campos: ['quantidade'] };

  const dados = { variacaoId: b.variacaoId, tipo: b.tipo, quantidade: q.valor };
  if (b.motivo !== undefined && b.motivo !== null && b.motivo !== '') {
    if (typeof b.motivo !== 'string') return { erro: 'Motivo inválido.', campos: ['motivo'] };
    dados.motivo = b.motivo.trim().slice(0, MAX_MOTIVO) || null;
  }
  for (const campo of ['precoCusto', 'precoVenda']) {
    if (b[campo] === undefined || b[campo] === null || b[campo] === '') continue;
    const p = lerDinheiro(b[campo], { min: 0, max: MAX_PRECO });
    if (!p.ok) return { erro: `${campo === 'precoCusto' ? 'Preço de custo' : 'Preço de venda'} inválido: ${p.erro}`, campos: [campo] };
    dados[campo] = p.valor;
  }
  if (b.vendaId !== undefined && b.vendaId !== null && b.vendaId !== '') {
    if (!ehUuid(b.vendaId)) return { erro: 'Venda não encontrada.', campos: ['vendaId'], status: 404 };
    dados.vendaId = b.vendaId;
  }
  if (b.categoriaId !== undefined && b.categoriaId !== null && b.categoriaId !== '') {
    if (!ehUuid(b.categoriaId)) return { erro: 'Categoria não encontrada.', campos: ['categoriaId'], status: 404 };
    dados.categoriaId = b.categoriaId;
  }
  return { dados };
}

/**
 * Valida a lista de ajustes (lote ou balanco). Item ruim = erro claro, nunca
 * "pulado em silencio". PURA.
 * @returns {{itens:Array<{variacaoId:string, novo:number, motivo:string|null}>}|{erro:string}}
 */
function validarAjustes(ajustes, campoQtd) {
  if (!Array.isArray(ajustes) || ajustes.length === 0) return { erro: 'Envie a lista de ajustes.' };
  if (ajustes.length > MAX_AJUSTES_LOTE) return { erro: `No máximo ${MAX_AJUSTES_LOTE} ajustes por vez.` };
  const itens = [];
  const vistos = new Set();
  for (let i = 0; i < ajustes.length; i++) {
    const a = ajustes[i] || {};
    if (!ehUuid(a.variacaoId)) return { erro: `Item ${i + 1}: produto não encontrado.`, status: 404 };
    if (vistos.has(a.variacaoId)) return { erro: `Item ${i + 1}: o mesmo produto aparece mais de uma vez.` };
    vistos.add(a.variacaoId);
    const q = lerInteiro(a[campoQtd], { min: 0, max: MAX_ESTOQUE });
    if (!q.ok) return { erro: `Item ${i + 1}: estoque inválido (${q.erro.replace(/\.$/, '')}; não pode ser negativo).` };
    const motivo = typeof a.motivo === 'string' ? a.motivo.trim().slice(0, MAX_MOTIVO) || null : null;
    itens.push({ variacaoId: a.variacaoId, novo: q.valor, motivo });
  }
  return { itens };
}

/**
 * Grava ajustes absolutos (estoque passa a ser X). A troca e condicional ao
 * saldo lido (se uma venda mexeu no meio, recusa em vez de apagar a venda da
 * conta). Tudo ou nada.
 */
async function aplicarAjustes(clienteId, itens, motivoPadrao) {
  return prisma.$transaction(async (tx) => {
    const feitos = [];
    for (const it of itens) {
      const variacao = await tx.variacaoProduto.findFirst({
        where: { id: it.variacaoId, produto: { clienteId } },
        include: { produto: { select: { nome: true, tipo: true } } },
      });
      if (!variacao) throw new ErroEstoque('Um dos produtos do ajuste não foi encontrado.', 404);
      const diferenca = it.novo - variacao.estoqueAtual;
      if (diferenca === 0) continue;
      const r = await tx.variacaoProduto.updateMany({
        where: { id: variacao.id, estoqueAtual: variacao.estoqueAtual },
        data: { estoqueAtual: it.novo },
      });
      if (r.count === 0) {
        throw new ErroEstoque(`O estoque de ${variacao.produto.nome} mudou enquanto você ajustava. Atualize a tela e tente de novo.`, 409);
      }
      await tx.movimentacaoEstoque.create({
        data: { variacaoId: variacao.id, tipo: 'AJUSTE', quantidade: diferenca, motivo: it.motivo || motivoPadrao },
      });
      feitos.push({ id: variacao.id, de: variacao.estoqueAtual, para: it.novo, diferenca });
    }
    return feitos;
  });
}

class EstoqueController {

  async registrarMovimentacao(req, res) {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });

    const v = validarMovimentacao(req.body);
    if (v.erro) return res.status(v.status || 422).json({ erro: v.erro, campos: v.campos });
    const { variacaoId, tipo, quantidade, motivo, vendaId, precoCusto, precoVenda, categoriaId } = v.dados;

    try {
      const variacao = await prisma.variacaoProduto.findFirst({
        where: { id: variacaoId, produto: { clienteId } },
        include: { produto: true }
      });
      if (!variacao) return res.status(404).json({ erro: 'Variação não encontrada.' });

      // ids de outras tabelas: so do mesmo negocio (outro negocio = 404).
      if (vendaId) {
        const venda = await prisma.venda.findFirst({ where: { id: vendaId, clienteId }, select: { id: true } });
        if (!venda) return res.status(404).json({ erro: 'Venda não encontrada.', campos: ['vendaId'] });
      }
      if (categoriaId) {
        const cat = await prisma.categoriaFinanceira.findFirst({ where: { id: categoriaId, clienteId }, select: { id: true } });
        if (!cat) return res.status(404).json({ erro: 'Categoria não encontrada.', campos: ['categoriaId'] });
      }

      const resultado = await prisma.$transaction(async (tx) => {
        // 1. Saldo: saida de produto fisico so se ainda houver (condicional,
        // a prova de saidas em paralelo).
        let atualizada;
        if (variacao.produto.tipo === 'FISICO' && quantidade < 0) {
          const r = await tx.variacaoProduto.updateMany({
            where: { id: variacaoId, estoqueAtual: { gte: -quantidade } },
            data: { estoqueAtual: { increment: quantidade } },
          });
          if (r.count === 0) {
            const atual = await tx.variacaoProduto.findUnique({ where: { id: variacaoId }, select: { estoqueAtual: true } });
            throw new ErroEstoque(`Estoque insuficiente. Saldo atual: ${atual?.estoqueAtual ?? 0}.`, 422, ['quantidade']);
          }
        } else {
          await tx.variacaoProduto.update({ where: { id: variacaoId }, data: { estoqueAtual: { increment: quantidade } } });
        }

        // 2. Precos (opcionais, ja validados).
        const precos = {};
        if (precoCusto !== undefined) precos.precoCusto = precoCusto;
        if (precoVenda !== undefined) precos.preco = precoVenda;
        if (Object.keys(precos).length) {
          await tx.variacaoProduto.update({ where: { id: variacaoId }, data: precos });
        }
        atualizada = await tx.variacaoProduto.findUnique({ where: { id: variacaoId }, select: { estoqueAtual: true } });

        // 3. Registro da movimentacao.
        const movimentacao = await tx.movimentacaoEstoque.create({
          data: {
            variacaoId, tipo, quantidade, motivo: motivo || null, vendaId: vendaId || null,
            ...(tipo === 'COMPRA_FORNECEDOR' ? { custoUnitario: precoCusto ?? variacao.precoCusto ?? null } : {}),
          }
        });

        // 4. Compra de fornecedor vira DESPESA no financeiro.
        if (tipo === 'COMPRA_FORNECEDOR') {
          const pCusto = precoCusto ?? variacao.precoCusto ?? 0;
          await tx.lancamentoFinanceiro.create({
            data: {
              clienteId,
              descricao: `Entrada de estoque: ${variacao.produto.nome} (${variacao.nome})`,
              valor: centavos(pCusto * quantidade),
              tipo: 'DESPESA',
              status: 'PAGO',
              dataVencimento: new Date(),
              dataPagamento: new Date(),
              categoriaId: categoriaId || null,
            }
          });
        }

        return { movimentacao, novoEstoque: atualizada.estoqueAtual };
      });

      return res.status(201).json({ success: true, data: resultado });
    } catch (error) {
      return responderErro(res, error, 'registrarMovimentacao');
    }
  }

  async ajusteLote(req, res) {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });
    const v = validarAjustes(req.body?.ajustes, 'novoEstoque');
    if (v.erro) return res.status(v.status || 400).json({ erro: v.erro });
    try {
      const feitos = await aplicarAjustes(clienteId, v.itens, 'Ajuste em lote');
      res.json({ success: true, total: feitos.length });
    } catch (error) {
      return responderErro(res, error, 'ajusteLote');
    }
  }

  /**
   * Conceito de Reserva (Soft Allocation):
   * Bloqueia temporariamente um item enquanto o pedido está em andamento.
   */
  async reservarEstoque(req, res) {
    const q = paraNumero(req.body?.quantidade);
    req.body = {
      variacaoId: req.body?.variacaoId,
      vendaId: req.body?.vendaId,
      tipo: 'RESERVA',
      quantidade: Number.isFinite(q) ? -Math.abs(q) : req.body?.quantidade,
      motivo: 'Reserva temporária para venda em andamento',
    };
    return this.registrarMovimentacao(req, res);
  }
  /**
   * Lista todas as movimentações de estoque do cliente.
   */
  async listarMovimentacoes(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });

      // Filtra apenas movimentacoes de produtos FISICOS — servicos nao tem
      // estoque, entao nao fazem sentido na tela de estoque. Vendas de servico
      // ainda geram MovimentacaoEstoque no banco (pra auditoria via vendaId),
      // mas nao aparecem aqui.
      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: {
          variacao: {
            produto: {
              clienteId,
              tipo: 'FISICO'
            }
          }
        },
        include: {
          variacao: {
            include: {
              produto: true
            }
          },
          venda: true
        },
        orderBy: { data: 'desc' }
      });

      res.json(movimentacoes);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar movimentações de estoque.' });
    }
  }

  /**
   * Dashboard de Estoque: KPIs de Patrimônio, Ruptura e Saúde do Inventário.
   */
  async dashboard(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });

      const variacoes = await prisma.variacaoProduto.findMany({
        where: { produto: { clienteId } },
        include: { produto: true }
      });

      const stats = {
        valorTotalInventario: 0, // Soma de (estoqueAtual * precoCusto)
        itensAbaixoMinimo: 0,    // estoqueAtual < estoqueMinimo
        indiceRuptura: 0,        // (itens zerados / total) * 100
        totalProdutos: variacoes.length,
        distribuicaoPorTipo: {}, // Físico vs Serviço (embora estoque seja mais para físico)
      };

      let itensZerados = 0;

      variacoes.forEach(v => {
        const estoque = v.estoqueAtual || 0;
        const custo = v.precoCusto || 0;
        
        stats.valorTotalInventario += (estoque * custo);

        if (v.estoqueMinimo !== null && estoque < v.estoqueMinimo) {
          stats.itensAbaixoMinimo++;
        }

        if (estoque <= 0) {
          itensZerados++;
        }
      });

      stats.indiceRuptura = variacoes.length > 0 
        ? parseFloat(((itensZerados / variacoes.length) * 100).toFixed(2)) 
        : 0;

      res.json(stats);
    } catch (error) {
      console.error('[EstoqueController.dashboard]', error);
      res.status(500).json({ error: 'Erro ao gerar dashboard de estoque.' });
    }
  }

  /**
   * Lista de Reposição: Itens que precisam de compra baseados no estoque ideal.
   */
  async listaReposicao(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });

      const itensParaRepor = await prisma.variacaoProduto.findMany({
        where: {
          produto: { clienteId },
          OR: [
            { estoqueAtual: { lt: prisma.variacaoProduto.fields.estoqueMinimo } },
            { estoqueAtual: { lt: prisma.variacaoProduto.fields.estoqueIdeal } }
          ]
        },
        include: { produto: true },
        orderBy: { estoqueAtual: 'asc' }
      });

      // Cálculo da necessidade. Inclui imagemUrl (da variacao ou fallback pro
      // produto) pra UI exibir thumb na lista de reposicao.
      const resultado = itensParaRepor.map(item => ({
        id: item.id,
        produto: item.produto.nome,
        variacao: item.nome,
        imagemUrl: item.imagemUrl || item.produto.imagemUrl || null,
        estoqueAtual: item.estoqueAtual,
        estoqueMinimo: item.estoqueMinimo,
        estoqueIdeal: item.estoqueIdeal,
        necessidade: (item.estoqueIdeal || 0) - item.estoqueAtual,
        urgencia: (item.estoqueMinimo !== null && item.estoqueAtual < item.estoqueMinimo) ? 'ALTA' : 'MEDIA'
      }));

      res.json(resultado);
    } catch (error) {
      console.error('[EstoqueController.listaReposicao]', error);
      res.status(500).json({ error: 'Erro ao listar reposição.' });
    }
  }

  /**
   * Ajuste de Balanço (Inventário Físico): sobrescreve o estoque atual com o
   * contado. Item inválido ou de outro negócio = erro claro (nada é gravado).
   */
  async ajusteBalanco(req, res) {
    const { clienteId } = req.usuario;
    if (!clienteId) return res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });
    const v = validarAjustes(req.body?.ajustes, 'estoqueReal');
    if (v.erro) return res.status(v.status || 422).json({ erro: v.erro });
    try {
      const feitos = await aplicarAjustes(clienteId, v.itens, 'Ajuste de Balanço (Inventário Físico)');
      res.json({ success: true, processados: feitos.length, detalhes: feitos });
    } catch (error) {
      return responderErro(res, error, 'ajusteBalanco');
    }
  }

  /**
   * Consulta o saldo atual e o histórico de uma variação específica.
   */
  async buscarSaldoPorVariacao(req, res) {
    try {
      const { variacaoId } = req.params;
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ error: 'Acesso negado: ID do cliente ausente.' });
      if (!ehUuid(variacaoId)) return res.status(404).json({ erro: 'Variação não encontrada.' });

      const variacao = await prisma.variacaoProduto.findFirst({
        where: {
          id: variacaoId,
          produto: { clienteId }
        },
        include: {
          produto: true,
          movimentacoes: {
            orderBy: { data: 'desc' },
            take: 50
          }
        }
      });

      if (!variacao) {
        return res.status(404).json({ error: 'Variação não encontrada.' });
      }

      res.json(variacao);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao buscar saldo da variação.' });
    }
  }
}

const instancia = new EstoqueController();
// Regras puras expostas pra teste.
instancia.validarMovimentacao = validarMovimentacao;
instancia.validarAjustes = validarAjustes;
module.exports = instancia;
