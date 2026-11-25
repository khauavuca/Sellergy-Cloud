const test = require('node:test');
const assert = require('node:assert');
const { chaveTrava, travarNegocio, tentarTravarNegocio } = require('./travaNegocio');

test('chave estavel, positiva e diferente por assunto', () => {
  const a = chaveTrava('equipe', 'c1');
  assert.equal(a, chaveTrava('equipe', 'c1'));
  assert.ok(a > 0n);
  assert.notEqual(a, chaveTrava('importacao', 'c1'));
  assert.notEqual(a, chaveTrava('equipe', 'c2'));
  assert.throws(() => chaveTrava('equipe', null));
});

test('usa pg_advisory_xact_lock / pg_try_advisory_xact_lock', async () => {
  const sqls = [];
  const tx = {
    $executeRawUnsafe: async (sql) => { sqls.push(sql); },
    $queryRawUnsafe: async (sql) => { sqls.push(sql); return [{ ok: false }]; },
  };
  await travarNegocio(tx, 'equipe', 'c1');
  assert.equal(await tentarTravarNegocio(tx, 'importacao', 'c1'), false);
  assert.match(sqls[0], /^SELECT pg_advisory_xact_lock\(\d+\)$/);
  assert.match(sqls[1], /pg_try_advisory_xact_lock\(\d+\)/);
});
