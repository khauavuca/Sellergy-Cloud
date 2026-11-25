const test = require('node:test');
const assert = require('node:assert');
const { validarDadosOficiais, gerarVerifyToken, conferirNaMeta } = require('./whatsappOficialConexao');

const TOKEN = `EAAG${'x'.repeat(120)}`;
const SEGREDO = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const ID = '1290672074119010';

test('aceita os 3 dados e limpa espaco, aspas, quebra de linha e "Bearer"', () => {
  const r = validarDadosOficiais({ identificadorCanal: ` ${ID}\n`, accessToken: `Bearer "${TOKEN}" `, appSecret: ` ${SEGREDO}\n` });
  assert.deepEqual(r, { ok: true, dados: { identificadorCanal: ID, accessToken: TOKEN, appSecret: SEGREDO } });
});

test('numero de telefone no lugar da identificacao recebe explicacao', () => {
  for (const errado of ['+55 11 98765-4321', '5511987654321', '(11) 98765-4321']) {
    const r = validarDadosOficiais({ identificadorCanal: errado, accessToken: TOKEN, appSecret: SEGREDO });
    assert.equal(r.ok, false, errado);
    assert.equal(r.campo, 'identificadorCanal');
    assert.match(r.erro, /número de telefone/);
  }
  assert.equal(validarDadosOficiais({ identificadorCanal: '12345', accessToken: TOKEN, appSecret: SEGREDO }).campo, 'identificadorCanal');
  assert.equal(validarDadosOficiais({ identificadorCanal: 'abc123', accessToken: TOKEN, appSecret: SEGREDO }).campo, 'identificadorCanal');
});

test('token cortado ou com lixo e recusado; token no lugar do segredo e avisado', () => {
  assert.equal(validarDadosOficiais({ identificadorCanal: ID, accessToken: 'EAAG123', appSecret: SEGREDO }).campo, 'accessToken');
  assert.equal(validarDadosOficiais({ identificadorCanal: ID, accessToken: `${TOKEN}<script>`, appSecret: SEGREDO }).campo, 'accessToken');
  const trocado = validarDadosOficiais({ identificadorCanal: ID, accessToken: 'EAAG' + 'y'.repeat(60), appSecret: 'EAAG' + 'y'.repeat(60) });
  assert.equal(trocado.campo, 'appSecret');
  assert.equal(validarDadosOficiais({ identificadorCanal: ID, accessToken: TOKEN, appSecret: 'segredo com espaço!' }).campo, 'appSecret');
});

test('primeira vez exige token e segredo; depois, vazio mantem o salvo', () => {
  assert.equal(validarDadosOficiais({ identificadorCanal: ID, appSecret: SEGREDO }).campo, 'accessToken');
  assert.equal(validarDadosOficiais({ identificadorCanal: ID, accessToken: TOKEN }).campo, 'appSecret');
  const soNumero = validarDadosOficiais({ identificadorCanal: ID }, { temToken: true, temSegredo: true });
  assert.deepEqual(soNumero, { ok: true, dados: { identificadorCanal: ID } });
});

test('verify token gerado e unico e sem caracteres estranhos', () => {
  const a = gerarVerifyToken();
  assert.match(a, /^sellergy-[a-f0-9]{24}$/);
  assert.notEqual(a, gerarVerifyToken());
});

const respostaFalsa = (status, corpo) => async () => ({ ok: status < 400, status, json: async () => corpo });

test('conferir na Meta: sem envio real nao chama a Meta', async () => {
  let chamou = false;
  const r = await conferirNaMeta({ phoneNumberId: ID, token: TOKEN, env: {}, fetchFn: async () => { chamou = true; } });
  assert.deepEqual(r, { ok: true, simulado: true });
  assert.equal(chamou, false);
});

test('conferir na Meta: numero achado devolve o numero e o nome', async () => {
  let urlChamada; let cabecalhos;
  const fetchFn = async (url, op) => { urlChamada = url; cabecalhos = op.headers; return respostaFalsa(200, { display_phone_number: '+55 11 98765-4321', verified_name: 'Clínica Lumi' })(); };
  const r = await conferirNaMeta({ phoneNumberId: ID, token: TOKEN, env: { WHATSAPP_ENVIO_REAL: '1' }, fetchFn });
  assert.deepEqual(r, { ok: true, numero: '+55 11 98765-4321', nome: 'Clínica Lumi' });
  assert.match(urlChamada, new RegExp(`/${ID}\\?fields=display_phone_number`));
  assert.equal(cabecalhos.Authorization, `Bearer ${TOKEN}`);
});

test('conferir na Meta: cada erro vira uma explicacao do que fazer', async () => {
  const env = { WHATSAPP_ENVIO_REAL: '1' };
  const casos = [
    [401, { error: { code: 190 } }, 'TOKEN_INVALIDO'],
    [400, { error: { code: 100 } }, 'NUMERO_NAO_ENCONTRADO'],
    [403, { error: { code: 10 } }, 'SEM_PERMISSAO'],
    [500, null, 'ERRO_META'],
  ];
  for (const [status, corpo, motivo] of casos) {
    const r = await conferirNaMeta({ phoneNumberId: ID, token: TOKEN, env, fetchFn: respostaFalsa(status, corpo) });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, motivo);
    assert.ok(r.erro.length > 20);
  }
  const caiu = await conferirNaMeta({ phoneNumberId: ID, token: TOKEN, env, fetchFn: async () => { throw new Error('timeout'); } });
  assert.equal(caiu.motivo, 'SEM_RESPOSTA');
});
