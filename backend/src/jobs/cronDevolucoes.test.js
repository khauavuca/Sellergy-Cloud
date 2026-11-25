const test = require('node:test');
const assert = require('node:assert');
const { limiteJanelaAviso } = require('./cronDevolucoes');

test('diasAvisoDevolucao=0 limita ao fim do dia atual', () => {
  const agora = new Date('2026-03-10T10:00:00');
  const limite = limiteJanelaAviso(0, agora);
  assert.strictEqual(limite.getDate(), 10);
  assert.strictEqual(limite.getHours(), 23);
  assert.strictEqual(limite.getMinutes(), 59);
});

test('diasAvisoDevolucao=1 estende o limite pro fim do dia seguinte', () => {
  const agora = new Date('2026-03-10T10:00:00');
  const limite = limiteJanelaAviso(1, agora);
  assert.strictEqual(limite.getDate(), 11);
});

test('diasAvisoDevolucao negativo ou ausente nao quebra (trata como 0)', () => {
  const agora = new Date('2026-03-10T10:00:00');
  assert.strictEqual(limiteJanelaAviso(-5, agora).getDate(), 10);
  assert.strictEqual(limiteJanelaAviso(undefined, agora).getDate(), 10);
});

// --- aviso por WhatsApp: canal do tenant, 55 no numero, respeita SAIR ---

test('aviso de devolucao usa o canal do tenant e poe o 55 no telefone', async () => {
  const prisma = require('../prisma');
  const { enviarAvisoWhatsapp } = require('./cronDevolucoes');
  prisma.optOutWhatsapp.findUnique = async () => null;
  const enviados = [];
  const canal = { ok: true, provedor: 'BAILEYS', adapter: { enviarTexto: async (m) => { enviados.push(m); return { ok: true }; } } };
  const r = await enviarAvisoWhatsapp({ canal, clienteId: 'c1', telefone: '(11) 98888-7777', texto: 'oi' });
  assert.equal(r.ok, true);
  assert.equal(enviados[0].para, '5511988887777');
});

test('aviso de devolucao nao vai pra quem pediu SAIR nem sem canal', async () => {
  const prisma = require('../prisma');
  const { enviarAvisoWhatsapp } = require('./cronDevolucoes');
  const enviados = [];
  const canal = { ok: true, adapter: { enviarTexto: async (m) => { enviados.push(m); return { ok: true }; } } };
  prisma.optOutWhatsapp.findUnique = async ({ where }) => (where.clienteId_telefone.telefone === '5511988887777' ? { id: 'x' } : null);
  assert.deepEqual(await enviarAvisoWhatsapp({ canal, clienteId: 'c1', telefone: '11988887777', texto: 'oi' }), { ok: false, motivo: 'OPT_OUT' });
  assert.equal((await enviarAvisoWhatsapp({ canal: { ok: false, motivo: 'SOCKET_INDISPONIVEL' }, clienteId: 'c1', telefone: '11911112222', texto: 'oi' })).motivo, 'SOCKET_INDISPONIVEL');
  assert.equal(enviados.length, 0);
});
