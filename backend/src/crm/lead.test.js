const test = require('node:test');
const assert = require('node:assert');
const l = require('./lead');

const AGORA = new Date('2026-11-25T15:00:00Z');

test('CPF com digito verificador', () => {
  assert.equal(l.cpfValido('529.982.247-25'), true);
  assert.equal(l.cpfValido('111.111.111-11'), false);
  assert.equal(l.cpfValido('529.982.247-24'), false);
  assert.equal(l.cpfValido('123'), false);
});

test('data de nascimento: recusa 31/02, ano 3000 e antes de 1900', () => {
  assert.ok(l.lerDataNascimento('2000-02-31', AGORA).erro);
  assert.ok(l.lerDataNascimento('3000-01-01', AGORA).erro);
  assert.ok(l.lerDataNascimento('1850-01-01', AGORA).erro);
  assert.ok(l.lerDataNascimento('ontem', AGORA).erro);
  assert.equal(l.lerDataNascimento('', AGORA).valor, null);
  assert.equal(l.lerDataNascimento('1990-05-10', AGORA).valor.toISOString(), '1990-05-10T12:00:00.000Z');
});

test('lerLead: etapa vazia vira null (lead sem etapa permitido)', () => {
  const r = l.lerLead({ nome: 'Maria', etapaId: '' });
  assert.equal(r.dados.etapaId, null);
  assert.equal(l.lerLead({ nome: 'Maria', etapaId: null }).dados.etapaId, null);
});

test('lerLead: entrada invalida vira erro claro, nao 500', () => {
  assert.deepEqual(l.lerLead({}).campos, ['nome']);
  assert.deepEqual(l.lerLead({ nome: '   ' }).campos, ['nome']);
  assert.deepEqual(l.lerLead({ nome: 123 }).campos, ['nome']);
  assert.deepEqual(l.lerLead({ nome: ['a'] }).campos, ['nome']);
  assert.deepEqual(l.lerLead({ nome: 'A', prioridade: 'URGENTE' }).campos, ['prioridade']);
  assert.deepEqual(l.lerLead({ nome: 'A', email: 'nao-e-email' }).campos, ['email']);
  assert.deepEqual(l.lerLead({ nome: 'A', telefone: '123' }).campos, ['telefone']);
  assert.deepEqual(l.lerLead({ nome: 'A', cpf: '111.111.111-11' }).campos, ['cpf']);
  assert.deepEqual(l.lerLead({ nome: 'A', observacoes: 'x'.repeat(3000) }).campos, ['observacoes']);
  assert.deepEqual(l.lerLead({ nome: 'A', observacoes: { a: 1 } }).campos, ['observacoes']);
  assert.deepEqual(l.lerLead({ nome: 'A', etapaId: 5 }).campos, ['etapaId']);
});

test('lerLead: normaliza e so pega campos permitidos', () => {
  const r = l.lerLead({ nome: ' Ana ', email: ' ANA@X.COM ', cpf: '529.982.247-25', clienteId: 'outro', valor: 999 });
  assert.deepEqual(r.dados, { nome: 'Ana', email: 'ana@x.com', cpf: '52998224725' });
});

test('lerLead parcial: so o que veio', () => {
  assert.deepEqual(l.lerLead({ observacoes: 'oi' }, { parcial: true }).dados, { observacoes: 'oi' });
});

test('MOVIDO so quando a etapa muda', () => {
  assert.equal(l.mudouDeEtapa('a', 'a'), false);
  assert.equal(l.mudouDeEtapa('a', undefined), false);
  assert.equal(l.mudouDeEtapa(null, null), false);
  assert.equal(l.mudouDeEtapa('a', 'b'), true);
  assert.equal(l.mudouDeEtapa('a', null), true);
});

test('observacao da linha do tempo', () => {
  assert.ok(l.lerObservacao('').erro);
  assert.ok(l.lerObservacao({}).erro);
  assert.ok(l.lerObservacao('x'.repeat(90000)).erro);
  assert.equal(l.lerObservacao(' oi ').valor, 'oi');
});

test('listagem e aniversarios', () => {
  assert.deepEqual(l.lerListagem({ pagina: '2', limite: '9999', aba: 'xx' }), { pagina: 2, limite: 200, aba: 'todos', busca: '', etapaId: '' });
  assert.deepEqual(l.diasDeAniversario(new Date('2026-12-28T12:00:00Z')), ['12-28', '12-29', '12-30', '12-31', '01-01', '01-02', '01-03']);
});
