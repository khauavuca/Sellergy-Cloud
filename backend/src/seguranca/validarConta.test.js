const test = require('node:test');
const assert = require('node:assert');
const v = require('./validarConta');

test('e-mail', () => {
  assert.equal(v.normalizarEmail('  A@B.COM '), 'a@b.com');
  assert.equal(v.normalizarEmail({}), null);
  assert.equal(v.emailValido('a@b.com'), true);
  for (const e of ['nao-e-email', '', 'a@b', 'a b@c.com']) assert.equal(v.emailValido(e), false, e);
});

test('senha nova: minimo 8, nao so espacos', () => {
  assert.ok(v.erroSenhaNova('1234567'));
  assert.ok(v.erroSenhaNova('        '));
  assert.ok(v.erroSenhaNova(['abcdefgh']));
  assert.ok(v.erroSenhaNova('a'.repeat(200)));
  assert.equal(v.erroSenhaNova('senhaboa1'), null);
});

test('nome', () => {
  assert.ok(v.validarNome('   ').erro);
  assert.ok(v.validarNome({}).erro);
  assert.ok(v.validarNome('x'.repeat(6000)).erro);
  assert.equal(v.validarNome(' Ana ').valor, 'Ana');
});

test('imagem: so data-URL de bitmap ou nosso armazenamento', () => {
  const env = { MINIO_PUBLIC_ENDPOINT: 'https://s3.sellergy.test' };
  assert.equal(v.validarImagem('').valor, null);
  assert.ok(v.validarImagem('javascript:alert(1)', { env }).erro);
  assert.ok(v.validarImagem('https://site-malicioso.example/x.png', { env }).erro);
  assert.ok(v.validarImagem('data:image/svg+xml;base64,PHN2Zz4=', { env }).erro);
  assert.ok(v.validarImagem({}, { env }).erro);
  assert.ok(v.validarImagem('data:image/png;base64,' + 'A'.repeat(500 * 1024), { env }).erro);
  assert.equal(v.validarImagem('data:image/png;base64,iVBORw0KGgo=', { env }).valor, 'data:image/png;base64,iVBORw0KGgo=');
  const nossa = 'https://s3.sellergy.test/sellergy-midia/x/logo.png';
  assert.equal(v.validarImagem(nossa, { env }).valor, nossa);
});

test('horario de funcionamento', () => {
  assert.ok(v.validarHorario({ abertura: '25:00', fechamento: '18:00', dias: [1] }).erro);
  assert.ok(v.validarHorario({ abertura: '08:00', fechamento: '99:99', dias: [1] }).erro);
  assert.ok(v.validarHorario({ abertura: '18:00', fechamento: '08:00', dias: [1] }).erro);
  assert.ok(v.validarHorario({ abertura: '08:00', fechamento: '08:00', dias: [1] }).erro);
  assert.ok(v.validarHorario({ abertura: '08:00', fechamento: '18:00', dias: [] }).erro);
  assert.ok(v.validarHorario({ abertura: '08:00', fechamento: '18:00', dias: [9] }).erro);
  assert.deepEqual(v.validarHorario({ abertura: '08:00', fechamento: '18:00', dias: [2, 1, 1] }).dados, { abertura: '08:00', fechamento: '18:00', dias: [1, 2] });
});

test('slug recusado em vez de trocado calado', () => {
  assert.ok(v.validarSlug('admin').erro);
  assert.ok(v.validarSlug('api').erro);
  assert.ok(v.validarSlug('\u{1F600}\u{1F600}\u{1F600}').erro);
  assert.ok(v.validarSlug('Clínica Bela').erro);
  assert.ok(v.validarSlug('ab').erro);
  assert.equal(v.validarSlug(' Studio-Bela ').valor, 'studio-bela');
});
