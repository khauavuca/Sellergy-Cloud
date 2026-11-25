const test = require('node:test');
const assert = require('node:assert');
const prisma = require('../prisma');

// Stubs ANTES de carregar o servico (ele desestrutura no require).
const credenciais = require('../credenciais');
credenciais.carregarCredencialDecifrada = async () => ({ dados: { accessToken: 'tok' } });
const adapters = require('../adapters/whatsapp');
const templates = [];
adapters.criarProvedorWhatsapp = () => ({ enviarTemplate: async (m) => { templates.push(m); return { ok: true }; } });

const { processarEnvioCampanha } = require('./campanhaService');

function mockar({ optOut = false, telefone = '(11) 98888-7777' } = {}) {
  const falhas = [];
  let enviado = false;
  prisma.campanhaEnvio.findUnique = async () => ({
    id: 'e1', campanhaId: 'k1', status: 'PENDENTE',
    campanha: { id: 'k1', clienteId: 'c1', nomeTemplate: 'promo', mensagem: null },
    lead: { id: 'l1', nome: 'Ana', telefone },
  });
  prisma.bot.findFirst = async () => ({ id: 'b1', provedorCanal: 'META_CLOUD', identificadorCanal: '123', credencialCanalId: 'cr1' });
  prisma.optOutWhatsapp.findUnique = async () => (optOut ? { id: 'o1' } : null);
  prisma.campanhaEnvio.update = async ({ data }) => { if (data.status === 'FALHOU') falhas.push(data.erro); else enviado = true; return data; };
  prisma.campanha.update = async () => ({});
  prisma.campanhaEnvio.count = async () => 1;
  prisma.$transaction = async (ops) => Promise.all(ops);
  return { falhas, enviado: () => enviado };
}

test('campanha oficial: telefone vai com 55 pro template', async () => {
  templates.length = 0;
  const m = mockar();
  await processarEnvioCampanha('e1');
  assert.equal(templates[0].para, '5511988887777');
  assert.equal(m.enviado(), true);
});

test('campanha oficial respeita o SAIR (opt-out) tambem', async () => {
  templates.length = 0;
  const m = mockar({ optOut: true });
  await processarEnvioCampanha('e1');
  assert.equal(templates.length, 0);
  assert.match(m.falhas[0], /SAIR/);
});

test('telefone invalido falha sem tentar enviar', async () => {
  templates.length = 0;
  const m = mockar({ telefone: '1234' });
  await processarEnvioCampanha('e1');
  assert.equal(templates.length, 0);
  assert.match(m.falhas[0], /invalido/);
});
