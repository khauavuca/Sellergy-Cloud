// Gravação das mensagens e pausa do bot no atendimento, com o Prisma em
// memória (sem banco). Roda em processo próprio (node --test), então os
// "dublês" abaixo não vazam pros outros testes.
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('../prisma');

// ---------- banco em memória (só o que a caixa de entrada usa) ----------
const conversasDb = [];
const mensagensDb = [];
let seq = 0;
const novoId = () => `id-${++seq}`;

function aplicar(c, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) c[k] = (c[k] || 0) + v.increment;
    else c[k] = v;
  }
  return c;
}

prisma.conversa.findUnique = async ({ where }) => {
  const k = where.clienteId_telefone;
  return conversasDb.find((c) => c.clienteId === k.clienteId && c.telefone === k.telefone) || null;
};
prisma.conversa.create = async ({ data }) => {
  const c = { id: novoId(), naoLidas: 0, botPausado: false, botPausadoAte: null, ...data };
  conversasDb.push(c);
  return c;
};
prisma.conversa.update = async ({ where, data }) => aplicar(conversasDb.find((c) => c.id === where.id), data);
prisma.mensagemConversa.create = async ({ data }) => {
  const m = { id: novoId(), criadoEm: new Date(), ...data };
  mensagensDb.push(m);
  return m;
};
prisma.$transaction = async (ops) => Promise.all(ops);
prisma.lead.findMany = async () => [{ id: 'lead-1', telefone: '(11) 98888-7777' }];
prisma.agendamento.findMany = async () => [];

const servico = require('./servico');
const { processarMensagemRecebida } = require('../services/whatsappInbound');

function adapterFalso() {
  const enviados = [];
  return { enviados, enviarTexto: async (m) => { enviados.push(m); return { ok: true, simulado: true }; } };
}

const bot = { id: 'bot-1', clienteId: 'neg-1', status: 'ONLINE', iaAtiva: false, provedorCanal: 'BAILEYS' };
const faqs = [{ ativo: true, ordem: 1, pergunta: 'Horario', resposta: 'Das 9h as 18h', palavrasChave: ['horario'] }];

test('mensagem recebida cria a conversa, liga ao lead pelo telefone e soma não lida', async () => {
  const r = await servico.registrarMensagem({
    clienteId: 'neg-1', telefone: '551188887777', texto: 'Oi', direcao: 'ENTRADA', origem: 'CONTATO', nomeContato: 'Maria',
  });
  assert.equal(r.conversa.telefone, '5511988887777'); // chave com o 9
  assert.equal(r.conversa.telefoneEnvio, '551188887777'); // responde do jeito que chegou
  assert.equal(r.conversa.leadId, 'lead-1');
  assert.equal(r.conversa.naoLidas, 1);
  assert.equal(r.conversa.nomeContato, 'Maria');
  assert.equal(r.mensagem.status, 'RECEBIDA');

  // Mesmo contato com o 9: mesma conversa.
  const r2 = await servico.registrarMensagem({ clienteId: 'neg-1', telefone: '5511988887777', texto: 'Tudo bem?', direcao: 'ENTRADA', origem: 'CONTATO' });
  assert.equal(r2.conversa.id, r.conversa.id);
  assert.equal(r2.conversa.naoLidas, 2);
});

test('mesmo telefone em outro negócio é outra conversa', async () => {
  const r = await servico.registrarMensagem({ clienteId: 'neg-2', telefone: '5511988887777', texto: 'Oi', direcao: 'ENTRADA', origem: 'CONTATO' });
  const daOutra = conversasDb.find((c) => c.clienteId === 'neg-1');
  assert.notEqual(r.conversa.id, daOutra.id);
});

test('texto vazio ou telefone inválido não grava; origem desconhecida é recusada', async () => {
  assert.equal(await servico.registrarMensagem({ clienteId: 'neg-1', telefone: '5511988887777', texto: '  ', direcao: 'ENTRADA', origem: 'CONTATO' }), null);
  assert.equal(await servico.registrarMensagem({ clienteId: 'neg-1', telefone: '12', texto: 'oi', direcao: 'ENTRADA', origem: 'CONTATO' }), null);
  await assert.rejects(() => servico.registrarMensagem({ clienteId: 'neg-1', telefone: '5511988887777', texto: 'oi', direcao: 'SAIDA', origem: 'HACKER' }));
  assert.equal(await servico.registrarSeguro({ clienteId: 'neg-1', telefone: '5511988887777', texto: 'oi', direcao: 'SAIDA', origem: 'HACKER' }), null);
});

test('bot responde e a resposta fica gravada como BOT', async () => {
  const adapter = adapterFalso();
  const antes = mensagensDb.length;
  await processarMensagemRecebida({ bot, texto: 'qual o horario?', de: '5562999990000', faqs, adapter, canalContexto: {} });
  assert.equal(adapter.enviados.length, 1);
  const novas = mensagensDb.slice(antes);
  assert.deepEqual(novas.map((m) => [m.direcao, m.origem]), [['ENTRADA', 'CONTATO'], ['SAIDA', 'BOT']]);
  assert.equal(novas[1].status, 'SIMULADA');
});

test('equipe assumiu (bot pausado): a mensagem é gravada e o bot NÃO responde', async () => {
  const conversa = conversasDb.find((c) => c.clienteId === 'neg-1' && c.telefone === '5562999990000');
  conversa.botPausado = true;
  conversa.botPausadoAte = new Date(Date.now() + 3600_000);
  const adapter = adapterFalso();
  const antes = mensagensDb.length;
  const r = await processarMensagemRecebida({ bot, texto: 'qual o horario?', de: '5562999990000', faqs, adapter, canalContexto: {} });
  assert.equal(r.origem, 'PAUSADO');
  assert.equal(adapter.enviados.length, 0);
  assert.equal(mensagensDb.length, antes + 1); // só a recebida
});

test('pausa vencida: o bot volta a responder sozinho', async () => {
  const conversa = conversasDb.find((c) => c.clienteId === 'neg-1' && c.telefone === '5562999990000');
  conversa.botPausadoAte = new Date(Date.now() - 1000);
  const adapter = adapterFalso();
  await processarMensagemRecebida({ bot, texto: 'qual o horario?', de: '5562999990000', faqs, adapter, canalContexto: {} });
  assert.equal(adapter.enviados.length, 1);
});

test('banco fora do ar: o bot continua respondendo (gravar é best-effort)', async () => {
  const original = prisma.conversa.findUnique;
  prisma.conversa.findUnique = async () => { throw new Error('banco caiu'); };
  try {
    const adapter = adapterFalso();
    await processarMensagemRecebida({ bot, texto: 'qual o horario?', de: '5562988880000', faqs, adapter, canalContexto: {} });
    assert.equal(adapter.enviados.length, 1);
  } finally {
    prisma.conversa.findUnique = original;
  }
});
