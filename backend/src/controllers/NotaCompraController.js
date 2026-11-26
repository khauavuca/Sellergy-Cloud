const prisma = require('../prisma');
const { calcularPreco } = require('../produto');
const { parseNfe } = require('../utils/nfeSeguro');
const { lerDinheiro, lerInteiro } = require('../utils/numero');

const MAX_ITENS = 200;
const NOME_CATEGORIA_COMPRA = 'Compra de mercadorias';

const arredondar = (n) => Math.round((Number(n) || 0) * 100) / 100;

const MAX_QTD_ITEM = 100000;
const MAX_CUSTO_UNITARIO = 1000000; // R$ 1 milhao por unidade — teto de sanidade
const MAX_NUMERO = 60;
const MAX_OBS = 2000;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (v) => typeof v === 'string' && RE_UUID.test(v);

/** Data "AAAA-MM-DD[...]" valida de verdade (sem 31/02), ano 1900..2100. PURA. */
function lerDataEstrita(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return null;
  if (dia > new Date(Date.UTC(ano, mes, 0)).getUTCDate()) return null;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Custo medio ponderado. Saldo negativo ou zero nao entra na conta (nao ha
 * unidade "a custo antigo" pra ponderar): o custo passa a ser o da nota.
 * Ex.: -5 a R$ 50 + 10 a R$ 60 = R$ 60 (antes dava R$ 70). PURA.
 */
function custoMedio(estoqueAtual, custoAtual, quantidade, custoNota) {
  const base = Math.max(0, Number(estoqueAtual) || 0);
  if (base === 0) return arredondar(custoNota);
  return arredondar((base * (Number(custoAtual) || 0) + quantidade * custoNota) / (base + quantidade));
}

/**
 * Valida o corpo da nota manual. PURA.
 * @returns {{dados:Object}|{erro:string, status?:number, campos?:string[]}}
 */
function validarNota(body) {
  const b = body && typeof body === 'object' ? body : {};
  const { itens } = b;
  if (!Array.isArray(itens) || itens.length === 0) return { erro: 'Inclua ao menos um item na nota.', campos: ['itens'] };
  if (itens.length > MAX_ITENS) return { erro: `Itens demais (limite de ${MAX_ITENS}).`, campos: ['itens'] };

  const normalizados = [];
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i] || {};
    if (!it.variacaoId || typeof it.variacaoId !== 'string') return { erro: `Item ${i + 1}: produto inválido.`, campos: ['itens'] };
    if (!ehUuid(it.variacaoId)) return { erro: 'Um dos produtos não foi encontrado.', status: 404 };
    const q = lerInteiro(it.quantidade, { min: 1, max: MAX_QTD_ITEM });
    if (!q.ok) return { erro: `Item ${i + 1}: quantidade deve ser um número inteiro de 1 a ${MAX_QTD_ITEM.toLocaleString('pt-BR')}.`, campos: ['quantidade'] };
    const c = lerDinheiro(it.custoUnitario, { min: 0, max: MAX_CUSTO_UNITARIO });
    if (!c.ok) return { erro: `Item ${i + 1}: custo unitário inválido (${c.erro.replace(/\.$/, '')}).`, campos: ['custoUnitario'] };
    normalizados.push({ variacaoId: it.variacaoId, quantidade: q.valor, custoUnitario: c.valor });
  }

  let fornecedorId = null;
  if (b.fornecedorId !== undefined && b.fornecedorId !== null && b.fornecedorId !== '') {
    if (!ehUuid(b.fornecedorId)) return { erro: 'Fornecedor não encontrado.', status: 404 };
    fornecedorId = b.fornecedorId;
  }
  let numero = null;
  if (b.numero !== undefined && b.numero !== null && b.numero !== '') {
    if (typeof b.numero !== 'string' && typeof b.numero !== 'number') return { erro: 'Número da nota inválido.', campos: ['numero'] };
    numero = String(b.numero).trim().slice(0, MAX_NUMERO) || null;
  }
  let observacoes = null;
  if (b.observacoes !== undefined && b.observacoes !== null && b.observacoes !== '') {
    if (typeof b.observacoes !== 'string') return { erro: 'Observações inválidas.', campos: ['observacoes'] };
    observacoes = b.observacoes.trim().slice(0, MAX_OBS) || null;
  }
  let emitidaEm = null;
  if (b.emitidaEm !== undefined && b.emitidaEm !== null && b.emitidaEm !== '') {
    emitidaEm = lerDataEstrita(b.emitidaEm);
    if (!emitidaEm) return { erro: 'Data de emissão inválida.', status: 422, campos: ['emitidaEm'] };
  }
  const ehPago = b.pago !== false && b.pago !== 'false';
  return { dados: { fornecedorId, numero, observacoes, emitidaEm, ehPago, normalizados } };
}

// Acha (ou cria) a categoria de despesa "Compra de mercadorias" do tenant.
// É o termo contábil padrão pra entrada de mercadoria; despesa VARIAVEL (anda
// com o volume de compras). Criada sob demanda na 1ª nota.
async function categoriaCompra(tx, clienteId) {
  let cat = await tx.categoriaFinanceira.findFirst({
    where: { clienteId, nome: NOME_CATEGORIA_COMPRA, tipo: 'DESPESA' },
  });
  if (!cat) {
    cat = await tx.categoriaFinanceira.create({
      data: { clienteId, nome: NOME_CATEGORIA_COMPRA, tipo: 'DESPESA', subTipo: 'VARIAVEL' },
    });
  }
  return cat;
}

const INCLUDE_NOTA = {
  fornecedor: { select: { id: true, nome: true, cnpj: true } },
  movimentacoes: {
    include: { variacao: { include: { produto: { select: { id: true, nome: true } } } } },
  },
};

class NotaCompraController {
  /**
   * Registra a entrada de uma nota de compra (manual). Numa transação:
   *  1. cria a NotaCompra (cabeçalho);
   *  2. pra cada item: movimentação COMPRA_FORNECEDOR (+estoque, custo congelado),
   *     recalcula o custo MÉDIO ponderado e o preço (custo+lucro) da variação;
   *  3. lança a despesa "Compra de mercadorias" pelo total.
   * Produto deve ser FÍSICO e do tenant. Tudo ou nada.
   */
  async criar(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' });

      const v = validarNota(req.body);
      if (v.erro) return res.status(v.status || 400).json({ erro: v.erro, ...(v.campos ? { campos: v.campos } : {}) });
      const { fornecedorId, numero, emitidaEm, observacoes, ehPago, normalizados } = v.dados;

      // Fornecedor do tenant (se informado).
      let fornecedor = null;
      if (fornecedorId) {
        fornecedor = await prisma.fornecedor.findFirst({ where: { id: fornecedorId, clienteId } });
        if (!fornecedor) return res.status(404).json({ erro: 'Fornecedor não encontrado.' });
      }

      // Carrega as variações (valida tenant + que são FÍSICO).
      const ids = [...new Set(normalizados.map((n) => n.variacaoId))];
      const variacoes = await prisma.variacaoProduto.findMany({
        where: { id: { in: ids }, produto: { clienteId } },
        include: { produto: true },
      });
      const mapaVar = new Map(variacoes.map((v) => [v.id, v]));
      for (const n of normalizados) {
        const v = mapaVar.get(n.variacaoId);
        if (!v) return res.status(404).json({ erro: 'Um dos produtos não foi encontrado.' });
        if (v.produto.tipo !== 'FISICO') {
          return res.status(422).json({ erro: `"${v.produto.nome}" não é um produto físico; não entra em nota de compra.` });
        }
      }

      const valorTotal = arredondar(
        normalizados.reduce((s, n) => s + n.quantidade * n.custoUnitario, 0),
      );

      const novaNota = await prisma.$transaction(async (tx) => {
        const nota = await tx.notaCompra.create({
          data: {
            clienteId,
            fornecedorId: fornecedor?.id || null,
            numero,
            origem: 'MANUAL',
            valorTotal,
            observacoes,
            emitidaEm,
          },
        });

        // Trava as variacoes da nota (ordem fixa, sem deadlock) e relê o saldo
        // e o custo: duas notas/vendas ao mesmo tempo nao usam saldo velho.
        const idsOrdenados = [...mapaVar.keys()].sort();
        for (const id of idsOrdenados) {
          await tx.$queryRaw`SELECT "id" FROM "variacoes_produto" WHERE "id" = ${id} FOR UPDATE`;
        }
        const frescas = await tx.variacaoProduto.findMany({
          where: { id: { in: idsOrdenados } },
          select: { id: true, estoqueAtual: true, precoCusto: true },
        });
        for (const f of frescas) {
          const v = mapaVar.get(f.id);
          v.estoqueAtual = f.estoqueAtual;
          v.precoCusto = f.precoCusto;
        }

        // Cada item: movimentação de entrada + recálculo de custo médio e preço.
        for (const n of normalizados) {
          const v = mapaVar.get(n.variacaoId);
          const estoqueAtual = v.estoqueAtual || 0;
          const novaQtd = estoqueAtual + n.quantidade;
          const novoCusto = custoMedio(estoqueAtual, v.precoCusto || 0, n.quantidade, n.custoUnitario);
          const novoPreco = calcularPreco(novoCusto, v.lucroTipo, v.lucroValor);

          await tx.movimentacaoEstoque.create({
            data: {
              variacaoId: v.id,
              tipo: 'COMPRA_FORNECEDOR',
              quantidade: n.quantidade,
              custoUnitario: n.custoUnitario, // custo congelado desta entrada
              notaCompraId: nota.id,
              motivo: `Entrada de nota${nota.numero ? ` ${nota.numero}` : ''}`,
            },
          });

          await tx.variacaoProduto.update({
            where: { id: v.id },
            data: {
              estoqueAtual: { increment: n.quantidade },
              precoCusto: novoCusto,
              preco: novoPreco,
            },
          });

          // Atualiza em memória caso a mesma variação apareça em outra linha.
          v.estoqueAtual = novaQtd;
          v.precoCusto = novoCusto;
        }

        // Despesa "Compra de mercadorias" pelo total da nota.
        const cat = await categoriaCompra(tx, clienteId);
        await tx.lancamentoFinanceiro.create({
          data: {
            clienteId,
            categoriaId: cat.id,
            descricao: `Compra de mercadorias${fornecedor ? ` — ${fornecedor.nome}` : ''}${nota.numero ? ` (nota ${nota.numero})` : ''}`,
            valor: valorTotal,
            tipo: 'DESPESA',
            status: ehPago ? 'PAGO' : 'PENDENTE',
            dataVencimento: nota.emitidaEm || new Date(),
            dataPagamento: ehPago ? new Date() : null,
          },
        });

        return nota;
      });

      const completa = await prisma.notaCompra.findFirst({
        where: { id: novaNota.id, clienteId },
        include: INCLUDE_NOTA,
      });
      res.status(201).json(completa);
    } catch (erro) {
      console.error('[notas-compra/criar]', erro);
      res.status(500).json({ erro: 'Erro ao registrar a entrada de nota.' });
    }
  }

  /**
   * Lê o XML de uma NF-e e devolve um PREVIEW (sem gravar nada). O parser é
   * defensivo (anti-XXE/DoS — ver utils/nfeSeguro). Tenta casar o fornecedor
   * pelo CNPJ. O usuário confere, mapeia cada item a um produto seu e confirma
   * via POST /notas-compra (criar).
   */
  async importarXml(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' });
      if (!req.file?.buffer) return res.status(400).json({ erro: 'Envie o XML da NF-e no campo "arquivo".' });

      let dados;
      try {
        dados = parseNfe(req.file.buffer);
      } catch (e) {
        if (e.code === 'XML_INVALIDO') return res.status(422).json({ erro: e.message });
        throw e;
      }

      // Tenta casar o fornecedor pelo CNPJ da nota (não grava nada).
      let fornecedor = null;
      const cnpj = dados.fornecedor?.cnpj || '';
      if (cnpj.length === 14) {
        fornecedor = await prisma.fornecedor.findFirst({
          where: { clienteId, cnpj },
          select: { id: true, nome: true },
        });
      }

      res.json({
        numero: dados.numero,
        emitidaEm: dados.emitidaEm,
        fornecedorXml: dados.fornecedor, // { cnpj, nome } lidos da nota
        fornecedor,                      // { id, nome } se já cadastrado; senão null
        itens: dados.itens,              // [{ codigo, descricao, quantidade, custoUnitario }]
      });
    } catch (erro) {
      console.error('[notas-compra/importar-xml]', erro);
      res.status(500).json({ erro: 'Erro ao ler o XML da NF-e.' });
    }
  }

  async listar(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!clienteId) return res.status(403).json({ erro: 'Acesso negado: usuario sem tenant.' });

      const notas = await prisma.notaCompra.findMany({
        where: { clienteId },
        orderBy: { criadoEm: 'desc' },
        take: 200,
        include: {
          fornecedor: { select: { id: true, nome: true } },
          _count: { select: { movimentacoes: true } },
        },
      });
      res.json(notas);
    } catch (erro) {
      console.error('[notas-compra/listar]', erro);
      res.status(500).json({ erro: 'Erro ao listar notas de compra.' });
    }
  }

  async buscarPorId(req, res) {
    try {
      const { clienteId } = req.usuario;
      if (!ehUuid(req.params.id)) return res.status(404).json({ erro: 'Nota não encontrada.' });
      const nota = await prisma.notaCompra.findFirst({
        where: { id: req.params.id, clienteId },
        include: INCLUDE_NOTA,
      });
      if (!nota) return res.status(404).json({ erro: 'Nota não encontrada.' });
      res.json(nota);
    } catch (erro) {
      console.error('[notas-compra/buscarPorId]', erro);
      res.status(500).json({ erro: 'Erro ao buscar nota.' });
    }
  }
}

const instancia = new NotaCompraController();
// Regras puras expostas pra teste.
instancia.validarNota = validarNota;
instancia.custoMedio = custoMedio;
module.exports = instancia;
