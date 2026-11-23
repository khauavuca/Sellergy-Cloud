const test = require('node:test');
const assert = require('node:assert');
const r = require('./regras');

test('token aleatorio, unico e com formato conferivel', () => {
  const a = r.gerarToken();
  const b = r.gerarToken();
  assert.notStrictEqual(a, b);
  assert.ok(r.tokenComFormatoValido(a));
  assert.ok(!r.tokenComFormatoValido('abc'));
  assert.ok(!r.tokenComFormatoValido(`${a}'; drop`));
});

test('expira em 7 dias e situacao do convite', () => {
  const agora = new Date('2026-11-23T12:00:00Z');
  const expira = r.calcularExpiracao(agora);
  assert.strictEqual(expira.toISOString(), '2026-11-30T12:00:00.000Z');
  assert.strictEqual(r.situacaoConvite({ expiraEm: expira }, agora), 'PENDENTE');
  assert.strictEqual(r.situacaoConvite({ expiraEm: expira }, new Date('2026-11-30T12:00:01Z')), 'EXPIRADO');
  assert.strictEqual(r.situacaoConvite({ expiraEm: expira, aceitoEm: agora }, new Date('2027-01-01')), 'ACEITO');
});

test('validacao do convite: campos, celular normalizado e hierarquia', () => {
  const ok = r.validarConvite({ nome: 'Bruno Lima', email: ' Bruno@Gmail.com ', telefone: '(11) 97321-5540', perfil: 'vendedor' }, { perfilSolicitante: 'CLIENT' });
  assert.deepStrictEqual(ok.dados, { nome: 'Bruno Lima', email: 'bruno@gmail.com', telefone: '5511973215540', perfil: 'VENDEDOR', especialistaId: null });

  const falta = r.validarConvite({ nome: 'B', email: 'x', perfil: 'DONO' }, { perfilSolicitante: 'CLIENT' });
  assert.deepStrictEqual(falta.campos.sort(), ['email', 'nome', 'perfil', 'telefone']);

  const adm = r.validarConvite({ nome: 'Ana', email: 'a@b.com', telefone: '11973215540', perfil: 'ADMINISTRADOR' }, { perfilSolicitante: 'ADMINISTRADOR' });
  assert.strictEqual(adm.status, 403);
  const vend = r.validarConvite({ nome: 'Ana', email: 'a@b.com', telefone: '11973215540', perfil: 'VENDEDOR' }, { perfilSolicitante: 'VENDEDOR' });
  assert.strictEqual(vend.status, 403);
  const esp = r.validarConvite({ nome: 'Ana', email: 'a@b.com', telefone: '11973215540', perfil: 'ADMINISTRADOR', especialistaId: 'x' }, { perfilSolicitante: 'CLIENT' });
  assert.ok(esp.erro);
});

test('senha com a mesma regra do cadastro e limite conta convites pendentes', () => {
  assert.ok(r.validarSenha('1234567'));
  assert.strictEqual(r.validarSenha('12345678'), null);
  assert.strictEqual(r.usoComConvites(4, 1), 5);
});

test('link e texto do convite', () => {
  assert.strictEqual(r.linkConvite('tok', 'https://sellergycloud.com/'), 'https://sellergycloud.com/convite/tok');
  const t = r.textoConvite({ nomeConvidado: 'Bruno Lima', nomeQuemConvidou: 'Marina', nomeNegocio: 'Clínica Lumi', link: 'L' });
  assert.match(t, /^Oi, Bruno! Marina te convidou pra equipe da Clínica Lumi/);
  assert.match(t, /7 dias/);
});
