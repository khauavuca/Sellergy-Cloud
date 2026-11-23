const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { garantirAmbienteSeguro, verificarAmbiente } = require('./validarAmbiente');

const hex = (n = 32) => crypto.randomBytes(n).toString('hex');

// Ambiente de producao correto (valores aleatorios a cada execucao).
function ambienteBom(extra = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: hex(),
    MENSAGENS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
    MINIO_SECRET_KEY: hex(),
    DATABASE_URL: `postgresql://sellergy:${hex()}@postgres:5432/sellergy_cloud?connection_limit=5`,
    REDIS_URL: `redis://:${hex()}@redis:6379`,
    CORS_ORIGINS: 'https://sellergycloud.com,https://www.sellergycloud.com',
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'lax',
    ...extra,
  };
}

const loggerMudo = { warn() {} };

test('producao com tudo certo: sobe sem erro', () => {
  const r = garantirAmbienteSeguro({ env: ambienteBom(), logger: loggerMudo });
  assert.deepStrictEqual(r.erros, []);
});

test('JWT_SECRET ausente, curto, de exemplo ou repetitivo: nao sobe', () => {
  for (const valor of [undefined, '', 'curto', 'TROQUE_AQUI', `troque_aqui_${hex()}`, 'a'.repeat(64), 'abababababababababababababababababab']) {
    const env = ambienteBom({ JWT_SECRET: valor });
    assert.throws(
      () => garantirAmbienteSeguro({ env, logger: loggerMudo }),
      (e) => e.code === 'AMBIENTE_INSEGURO' && e.problemas.some((p) => p.startsWith('JWT_SECRET')),
      `valor: ${valor}`,
    );
  }
});

test('mensagem de erro nunca contem o valor do segredo', () => {
  const segredo = 'segredo-curto-123';
  try {
    garantirAmbienteSeguro({ env: ambienteBom({ JWT_SECRET: segredo }), logger: loggerMudo });
    assert.fail('deveria lancar');
  } catch (e) {
    assert.ok(!e.message.includes(segredo));
  }
});

test('MENSAGENS_MASTER_KEY precisa ser 32 bytes em base64', () => {
  const curta = verificarAmbiente(ambienteBom({ MENSAGENS_MASTER_KEY: crypto.randomBytes(16).toString('base64') }));
  assert.ok(curta.erros.some((e) => e.startsWith('MENSAGENS_MASTER_KEY')));
  const exemplo = verificarAmbiente(ambienteBom({ MENSAGENS_MASTER_KEY: 'TROQUE_AQUI_BASE64_32_BYTES' }));
  assert.ok(exemplo.erros.some((e) => e.startsWith('MENSAGENS_MASTER_KEY')));
});

test('MINIO_SECRET_KEY copiado do exemplo e barrado', () => {
  const r = verificarAmbiente(ambienteBom({ MINIO_SECRET_KEY: 'MESMO_VALOR_DO_MINIO_ROOT_PASSWORD' }));
  assert.ok(r.erros.some((e) => e.startsWith('MINIO_SECRET_KEY')));
});

test('Redis sem senha ou com senha fraca: nao sobe', () => {
  assert.ok(verificarAmbiente(ambienteBom({ REDIS_URL: 'redis://redis:6379' })).erros.some((e) => e.includes('REDIS_URL sem senha')));
  assert.ok(verificarAmbiente(ambienteBom({ REDIS_URL: 'redis://:123@redis:6379' })).erros.some((e) => e.includes('Redis')));
  assert.ok(verificarAmbiente(ambienteBom({ REDIS_URL: undefined })).erros.some((e) => e.startsWith('REDIS_URL')));
});

test('senha do Postgres fraca ou de exemplo: nao sobe', () => {
  const r = verificarAmbiente(ambienteBom({ DATABASE_URL: 'postgresql://u:TROQUE_AQUI@postgres:5432/db' }));
  assert.ok(r.erros.some((e) => e.includes('Postgres')));
});

test('Asaas: webhook token vira obrigatorio quando a chave da API existe', () => {
  const semToken = verificarAmbiente(ambienteBom({ ASAAS_PLATAFORMA_API_KEY: `$aact_${hex()}` }));
  assert.ok(semToken.erros.some((e) => e.startsWith('ASAAS_PLATAFORMA_WEBHOOK_TOKEN')));

  const completo = verificarAmbiente(ambienteBom({
    ASAAS_PLATAFORMA_API_KEY: `$aact_${hex()}`,
    ASAAS_PLATAFORMA_WEBHOOK_TOKEN: hex(),
    ASAAS_PLATAFORMA_AMBIENTE: 'producao',
  }));
  assert.deepStrictEqual(completo.erros, []);

  const ambienteErrado = verificarAmbiente(ambienteBom({ ASAAS_PLATAFORMA_AMBIENTE: 'prod' }));
  assert.ok(ambienteErrado.erros.some((e) => e.startsWith('ASAAS_PLATAFORMA_AMBIENTE')));
});

test('interruptores aceitam so o valor exato que o codigo compara', () => {
  // BAILEYS_ENVIO_REAL e lido como === '1'; ADMIN_2FA_OBRIGATORIO como === 'true'.
  const r = verificarAmbiente(ambienteBom({ BAILEYS_ENVIO_REAL: 'true', ADMIN_2FA_OBRIGATORIO: '1' }));
  assert.ok(r.erros.some((e) => e.startsWith('BAILEYS_ENVIO_REAL')));
  assert.ok(r.erros.some((e) => e.startsWith('ADMIN_2FA_OBRIGATORIO')));
  const ok = verificarAmbiente(ambienteBom({ BAILEYS_ENVIO_REAL: '1', WHATSAPP_ENVIO_REAL: '0', ADMIN_2FA_OBRIGATORIO: 'true' }));
  assert.deepStrictEqual(ok.erros, []);
});

test('PLATAFORMA_CLIENTE_ID com formato estranho e barrado', () => {
  assert.ok(verificarAmbiente(ambienteBom({ PLATAFORMA_CLIENTE_ID: 'id com espaco' })).erros.some((e) => e.startsWith('PLATAFORMA_CLIENTE_ID')));
  assert.deepStrictEqual(verificarAmbiente(ambienteBom({ PLATAFORMA_CLIENTE_ID: 'clx1a2b3c4d5e6f7g8h9' })).erros, []);
});

test('CORS aberto ou com localhost em producao: nao sobe', () => {
  for (const origens of ['*', 'http://localhost:5173', 'https://sellergycloud.com,http://sellergycloud.com']) {
    const r = verificarAmbiente(ambienteBom({ CORS_ORIGINS: origens }));
    assert.ok(r.erros.some((e) => e.startsWith('CORS_ORIGINS')), origens);
  }
});

test('avisos (cookie inseguro, 2FA desligado) nao derrubam o boot', () => {
  const avisos = [];
  const r = garantirAmbienteSeguro({
    env: ambienteBom({ COOKIE_SECURE: 'false', ADMIN_2FA_OBRIGATORIO: 'false' }),
    logger: { warn: (m) => avisos.push(m) },
  });
  assert.deepStrictEqual(r.erros, []);
  assert.ok(avisos.some((a) => a.includes('COOKIE_SECURE')));
  assert.ok(avisos.some((a) => a.includes('ADMIN_2FA_OBRIGATORIO')));
});

test('fora de producao nao lanca (so devolve os problemas)', () => {
  const r = garantirAmbienteSeguro({ env: { NODE_ENV: 'development', JWT_SECRET: 'dev' }, logger: loggerMudo });
  assert.ok(r.erros.length > 0);
});
