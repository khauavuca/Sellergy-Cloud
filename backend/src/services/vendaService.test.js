// Nucleo da venda com transacao falsa (sem banco): trava do numero, baixa
// condicional de estoque, cupom condicional e dinheiro em centavos.
const test = require('node:test');
const assert = require('node:assert');
const { criarVenda, ErroVenda, baixarEstoque } = require('./vendaService');

function variacao({ id = 'v1', estoque = 1, tipo = 'FISICO' } = {}) {
  return { id, nome: 'Un', precoCusto: 1, produto: { nome: 'Relógio', tipo, categoriaId: null, temDevolucao: false } };
}

// tx falsa: guarda as chamadas; estoque e cupom simulam o UPDATE condicional.
function fakeTx({ estoque = { v1: 1 }, cupomDisponivel = true } = {}) {
  const log = { locks: [], updatesEstoque: [], lancamentos: [], venda: null };
  const tx = {
    $executeRawUnsafe: async (sql) => { log.locks.push(sql); },
    venda: {
      findFirst: async () => ({ numero: 41 }),
      create: async ({ data }) => { log.venda = { id: 'venda1', ...data }; return log.venda; },
    },
    cupom: {
      updateMany: async () => ({ count: cupomDisponivel ? 1 : 0 }),
    },
    movimentacaoEstoque: { create: async () => ({}) },
    variacaoProduto: {
      updateMany: async ({ where, data }) => {
        log.updatesEstoque.push({ where, data });
        const atual = estoque[where.id];
        if (atual >= where.estoqueAtual.gte) {
          estoque[where.id] = atual - data.estoqueAtual.decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
      update: async ({ where, data }) => { estoque[where.id] -= data.estoqueAtual.decrement; return {}; },
      findUnique: async ({ where }) => ({ estoqueAtual: estoque[where.id] }),
    },
    lancamentoFinanceiro: { create: async ({ data }) => { log.lancamentos.push(data); return data; } },
    devolucao: { create: async () => ({}) },
  };
  return { tx, log, estoque };
}

const base = { clienteId: 'c1', sessaoCaixaId: 's1', descricaoVenda: 'teste' };

test('criarVenda trava o numero da venda do negocio e usa o proximo numero', async () => {
  const { tx, log } = fakeTx();
  const r = await criarVenda({ ...base, tx, exigirEstoque: true, itensValidados: [{ variacao: variacao(), quantidade: 1, precoUnitario: 50, subtotal: 50 }] });
  assert.strictEqual(log.locks.length, 1);
  assert.match(log.locks[0], /pg_advisory_xact_lock/);
  assert.strictEqual(r.venda.numero, 42);
});

test('criarVenda recusa o ultimo item vendido de novo (baixa condicional) com ErroVenda 422', async () => {
  const { tx, estoque } = fakeTx({ estoque: { v1: 0 } });
  await assert.rejects(
    criarVenda({ ...base, tx, exigirEstoque: true, itensValidados: [{ variacao: variacao(), quantidade: 1, precoUnitario: 50, subtotal: 50 }] }),
    (e) => e instanceof ErroVenda && e.status === 422 && e.codigo === 'ESTOQUE_INSUFICIENTE',
  );
  assert.strictEqual(estoque.v1, 0);
});

test('criarVenda: mesmo item 2x na lista nao passa do estoque', async () => {
  const { tx } = fakeTx({ estoque: { v1: 1 } });
  const it = { variacao: variacao(), quantidade: 1, precoUnitario: 5, subtotal: 5 };
  await assert.rejects(criarVenda({ ...base, tx, exigirEstoque: true, itensValidados: [it, it] }), ErroVenda);
});

test('criarVenda sem exigirEstoque (pagamento ja recebido) baixa mesmo sem saldo', async () => {
  const { tx, estoque } = fakeTx({ estoque: { v1: 0 } });
  await criarVenda({ ...base, tx, exigirEstoque: false, itensValidados: [{ variacao: variacao(), quantidade: 1, precoUnitario: 5, subtotal: 5 }] });
  assert.strictEqual(estoque.v1, -1);
});

test('criarVenda: cupom esgotado entre a validacao e a gravacao desfaz a venda', async () => {
  const { tx } = fakeTx({ cupomDisponivel: false });
  await assert.rejects(
    criarVenda({ ...base, tx, exigirEstoque: true, cupomAplicado: { cupomId: 'k1', valorComDesconto: 45 }, itensValidados: [{ variacao: variacao(), quantidade: 1, precoUnitario: 50, subtotal: 50 }] }),
    (e) => e instanceof ErroVenda && e.codigo === 'CUPOM_ESGOTADO',
  );
});

test('criarVenda arredonda o valor em centavos (3 x 0,10 = 0,30)', async () => {
  const { tx, log } = fakeTx({ estoque: { v1: 10 } });
  const r = await criarVenda({ ...base, tx, exigirEstoque: true, itensValidados: [{ variacao: variacao(), quantidade: 3, precoUnitario: 0.1, subtotal: 0.1 * 3 }] });
  assert.strictEqual(r.valorTotal, 0.3);
  assert.strictEqual(log.venda.valor, 0.3);
  assert.strictEqual(log.lancamentos[0].valor, 0.3);
});

test('baixarEstoque condicional pede estoqueAtual >= quantidade no WHERE', async () => {
  const { tx, log } = fakeTx({ estoque: { v1: 5 } });
  assert.strictEqual(await baixarEstoque(tx, 'v1', 2), true);
  assert.deepStrictEqual(log.updatesEstoque[0].where, { id: 'v1', estoqueAtual: { gte: 2 } });
});
