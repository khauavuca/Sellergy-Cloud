const test = require('node:test');
const assert = require('node:assert');
const prisma = require('../prisma');
const { processarMensagemRecebida, botPodeResponder, CAMPOS_BOT_ATENDIMENTO } = require('./whatsappInbound');

// Sem lembrete pendente e sem lead: o que sobra e a decisao do bot.
prisma.agendamento.findMany = async () => [];
prisma.lead.findMany = async () => [];
// Caixa de entrada fora deste teste (tem o proprio: conversas/conversas.test.js).
const conversas = require('../conversas/servico');
conversas.registrarSeguro = async () => null;
conversas.pausaDoContato = async () => false;

function adapterFalso() {
  const enviados = [];
  return { enviados, enviarTexto: async (m) => { enviados.push(m); return { ok: true }; } };
}

const faqs = [{ ativo: true, ordem: 1, pergunta: 'Horario', resposta: 'Das 9h as 18h', palavrasChave: [] }];

test('select do atendimento traz status e acoesPermitidas (ferramentas da IA e bot desligado)', () => {
  assert.equal(CAMPOS_BOT_ATENDIMENTO.status, true);
  assert.equal(CAMPOS_BOT_ATENDIMENTO.acoesPermitidas, true);
  assert.equal(CAMPOS_BOT_ATENDIMENTO.iaExcedenteAutorizadoTokens, true);
});

test('so bot ONLINE responde', () => {
  assert.equal(botPodeResponder({ status: 'ONLINE' }), true);
  assert.equal(botPodeResponder({ status: 'OFFLINE' }), false);
  assert.equal(botPodeResponder({ status: 'ERROR' }), false);
});

test('bot OFFLINE nao responde nada', async () => {
  const adapter = adapterFalso();
  const r = await processarMensagemRecebida({
    bot: { id: 'b-off', clienteId: 'c', status: 'OFFLINE', iaAtiva: false },
    texto: 'oi', de: '5511911112222', faqs, adapter, canalContexto: {},
  });
  assert.equal(r, null);
  assert.equal(adapter.enviados.length, 0);
});

test('resposta sem IA tem limite por contato (loop com outro robo)', async () => {
  process.env.BOT_LIMITE_RESPOSTAS_POR_CONTATO_HORA = '3';
  const adapter = adapterFalso();
  const bot = { id: 'b-loop', clienteId: 'c', status: 'ONLINE', iaAtiva: false };
  for (let i = 0; i < 5; i++) {
    await processarMensagemRecebida({ bot, texto: 'mensagem automatica do outro robo', de: '5511933334444', faqs, adapter, canalContexto: {} });
  }
  assert.equal(adapter.enviados.length, 3);
  // Outro contato continua sendo atendido.
  await processarMensagemRecebida({ bot, texto: 'oi', de: '5511955556666', faqs, adapter, canalContexto: {} });
  assert.equal(adapter.enviados.length, 4);
  delete process.env.BOT_LIMITE_RESPOSTAS_POR_CONTATO_HORA;
});
