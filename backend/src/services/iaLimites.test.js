const test = require('node:test');
const assert = require('node:assert');
const prisma = require('../prisma');
const {
  avaliarCota, avaliarTetoGlobal, tetoDiarioTokens, diaAtual, TETO_DIARIO_PADRAO,
  verificarDisponibilidadeIA, registrarConsumoGlobal, avisarCotaEsgotada,
} = require('./iaLimites');

// Prisma falso em memoria — so o que iaLimites usa.
function mockarPrisma({ tokensHoje = 0, usadoMes = 0, avisado = false } = {}) {
  const estado = { notificacoes: [], diario: { tokensUsados: tokensHoje, tetoAtingidoEm: null }, avisado };
  prisma.consumoIADiario.findUnique = async () => ({ ...estado.diario });
  prisma.consumoIADiario.upsert = async ({ update }) => {
    estado.diario.tokensUsados += update.tokensUsados.increment;
    return { ...estado.diario };
  };
  prisma.consumoIADiario.updateMany = async () => {
    if (estado.diario.tetoAtingidoEm) return { count: 0 };
    estado.diario.tetoAtingidoEm = new Date();
    return { count: 1 };
  };
  prisma.consumoIA.aggregate = async () => ({ _sum: { tokensUsados: usadoMes } });
  prisma.consumoIA.upsert = async () => ({});
  prisma.consumoIA.updateMany = async () => {
    if (estado.avisado) return { count: 0 };
    estado.avisado = true;
    return { count: 1 };
  };
  prisma.notificacao.create = async ({ data }) => { estado.notificacoes.push(data); return data; };
  return estado;
}

const bot = { id: 'bot-1', clienteId: 'cli-1', iaTokensIncluidosMes: 2_000_000, iaExcedenteAutorizadoTokens: 0 };

test('cota: 2 milhoes inclusos, sem excedente automatico', () => {
  assert.deepEqual(avaliarCota({ usadoMes: 1_999_999, tokensIncluidosMes: 2_000_000 }), { limite: 2_000_000, restante: 1, esgotada: false });
  assert.equal(avaliarCota({ usadoMes: 2_000_000, tokensIncluidosMes: 2_000_000 }).esgotada, true);
  // Pacote extra autorizado soma no teto.
  assert.equal(avaliarCota({ usadoMes: 2_500_000, tokensIncluidosMes: 2_000_000, excedenteAutorizado: 1_000_000 }).esgotada, false);
});

test('teto global: padrao, env e 0 como interruptor', () => {
  delete process.env.IA_TETO_DIARIO_TOKENS;
  assert.equal(tetoDiarioTokens(), TETO_DIARIO_PADRAO);
  process.env.IA_TETO_DIARIO_TOKENS = '5000';
  assert.equal(tetoDiarioTokens(), 5000);
  process.env.IA_TETO_DIARIO_TOKENS = '0';
  assert.equal(tetoDiarioTokens(), 0);
  assert.equal(avaliarTetoGlobal({ tokensHoje: 0, teto: 0 }).bloqueado, true);
  process.env.IA_TETO_DIARIO_TOKENS = 'xyz';
  assert.equal(tetoDiarioTokens(), TETO_DIARIO_PADRAO);
  delete process.env.IA_TETO_DIARIO_TOKENS;
});

test('dia no fuso de Sao Paulo (01:00 UTC ainda e o dia anterior)', () => {
  assert.equal(diaAtual(new Date('2026-11-25T01:00:00Z')), '2026-11-24');
  assert.equal(diaAtual(new Date('2026-11-25T04:00:00Z')), '2026-11-25');
});

test('teto global estourado desliga a IA pra todos', async () => {
  process.env.IA_TETO_DIARIO_TOKENS = '1000';
  mockarPrisma({ tokensHoje: 1000 });
  const r = await verificarDisponibilidadeIA({ bot, de: '5511911110000', periodo: '2026-11' });
  assert.deepEqual(r, { liberado: false, motivo: 'TETO_GLOBAL' });
  delete process.env.IA_TETO_DIARIO_TOKENS;
});

test('cota do cliente esgotada: IA fecha e o dono e avisado UMA vez', async () => {
  const estado = mockarPrisma({ usadoMes: 2_000_000 });
  const r1 = await verificarDisponibilidadeIA({ bot, de: '5511911110001', periodo: '2026-11' });
  assert.deepEqual(r1, { liberado: false, motivo: 'COTA_ESGOTADA' });
  await new Promise((ok) => setImmediate(ok)); // aviso e assincrono
  await verificarDisponibilidadeIA({ bot, de: '5511911110001', periodo: '2026-11' });
  await new Promise((ok) => setImmediate(ok));
  assert.equal(estado.notificacoes.length, 1);
  assert.equal(estado.notificacoes[0].clienteId, 'cli-1');
  assert.match(estado.notificacoes[0].mensagem, /menu de perguntas/);
  assert.equal(await avisarCotaEsgotada({ bot, periodo: '2026-11' }), false);
});

test('limite por contato fecha a IA depois de N respostas na hora', async () => {
  process.env.IA_LIMITE_RESPOSTAS_POR_CONTATO_HORA = '2';
  mockarPrisma({ usadoMes: 10 });
  const de = '5511922223333';
  assert.equal((await verificarDisponibilidadeIA({ bot, de, periodo: '2026-11' })).liberado, true);
  assert.equal((await verificarDisponibilidadeIA({ bot, de, periodo: '2026-11' })).liberado, true);
  assert.deepEqual(await verificarDisponibilidadeIA({ bot, de, periodo: '2026-11' }), { liberado: false, motivo: 'LIMITE_CONTATO' });
  delete process.env.IA_LIMITE_RESPOSTAS_POR_CONTATO_HORA;
});

test('erro ao ler consumo: falha fechado (sem IA nesta mensagem)', async () => {
  mockarPrisma();
  prisma.consumoIADiario.findUnique = async () => { throw new Error('banco fora'); };
  assert.deepEqual(await verificarDisponibilidadeIA({ bot, de: '5511900000009', periodo: '2026-11' }), { liberado: false, motivo: 'ERRO_CONSUMO' });
});

test('registrarConsumoGlobal soma e marca o alerta so na primeira vez que estoura', async () => {
  process.env.IA_TETO_DIARIO_TOKENS = '1000';
  const estado = mockarPrisma({ tokensHoje: 900 });
  const errosOriginal = console.error;
  const alertas = [];
  console.error = (...a) => alertas.push(a.join(' '));
  try {
    await registrarConsumoGlobal(200);
    await registrarConsumoGlobal(50);
  } finally {
    console.error = errosOriginal;
    delete process.env.IA_TETO_DIARIO_TOKENS;
  }
  assert.equal(estado.diario.tokensUsados, 1150);
  assert.ok(estado.diario.tetoAtingidoEm);
  assert.equal(alertas.filter((a) => a.includes('[ALERTA]')).length, 1);
});
