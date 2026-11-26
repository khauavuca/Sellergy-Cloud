const test = require('node:test');
const assert = require('node:assert');
const { planoDePadroes, criarPadroesDoNegocio } = require('./padroes');

test('servico e hibrido ganham a dona como profissional; loja nao', () => {
  assert.equal(planoDePadroes('SERVICO').donoProfissional, true);
  assert.equal(planoDePadroes('HIBRIDO').donoProfissional, true);
  assert.equal(planoDePadroes('PRODUTO').donoProfissional, false);
  const p = planoDePadroes('SERVICO');
  assert.deepEqual(p.etapas.map((e) => e.slug), ['novo', 'em-contato', 'fechado-ganho']);
  assert.deepEqual(p.categorias.map((c) => `${c.tipo}/${c.uso}`), ['RECEITA/SERVICO', 'RECEITA/PRODUTO', 'DESPESA/DESPESA']);
});

function txFalso({ categorias = [], etapas = 0, especialistas = 0 } = {}) {
  const criado = { categorias: [], etapas: [], especialistas: [] };
  return {
    criado,
    categoriaFinanceira: { findMany: async () => categorias, createMany: async ({ data }) => { criado.categorias.push(...data); } },
    etapaLead: { count: async () => etapas, createMany: async ({ data }) => { criado.etapas.push(...data); } },
    especialista: { count: async () => especialistas, create: async ({ data }) => { criado.especialistas.push(data); } },
  };
}

test('conta nova recebe categorias, etapas e a dona como profissional', async () => {
  const tx = txFalso();
  await criarPadroesDoNegocio(tx, { clienteId: 'c1', segmento: 'SERVICO', usuario: { id: 'u1', nome: 'Ana' } });
  assert.equal(tx.criado.categorias.length, 3);
  assert.equal(tx.criado.etapas.length, 3);
  assert.deepEqual(tx.criado.especialistas, [{ clienteId: 'c1', nome: 'Ana', usuarioId: 'u1', ativo: true }]);
});

test('idempotente: nao duplica o que ja existe', async () => {
  const tx = txFalso({ categorias: [{ tipo: 'RECEITA', uso: 'SERVICO' }], etapas: 2, especialistas: 1 });
  await criarPadroesDoNegocio(tx, { clienteId: 'c1', segmento: 'SERVICO', usuario: { id: 'u1', nome: 'Ana' } });
  assert.deepEqual(tx.criado.categorias.map((c) => c.uso), ['PRODUTO', 'DESPESA']);
  assert.equal(tx.criado.etapas.length, 0);
  assert.equal(tx.criado.especialistas.length, 0);
});
