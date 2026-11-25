// Lembrete so e marcado como enviado DEPOIS do sucesso; falha passageira
// (socket do QR Code fora do ar) fica pra proxima rodada, com limite.
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('../prisma');
const { processarLembretes, decidirAposFalha, MAX_TENTATIVAS } = require('./lembretes');

const agora = new Date('2026-11-24T12:00:00Z');

function mockar({ tentativas = 0 } = {}) {
  const linha = {
    id: 'ag1', clienteId: 'c1', data: new Date(agora.getTime() + 20 * 3_600_000), status: 'PENDING',
    nomeCliente: 'Ana', telefoneCliente: '11988887777', servico: 'Corte', tokenConfirmacao: 'tok_1234567890',
    lembrete24hEm: null, lembrete2hEm: null, lembreteReservadoAte: null, lembreteTentativas: tentativas,
    especialista: null,
    cliente: { nome: 'Salao', plano: 'PRO', statusAssinatura: 'ATIVA', trialAte: null, configLembrete: null },
  };
  const historico = [];
  prisma.agendamento.findMany = async () => (linha.lembrete24hEm ? [] : [{ ...linha }]);
  prisma.agendamento.count = async () => 0;
  prisma.agendamento.updateMany = async ({ where, data }) => {
    const reservaViva = linha.lembreteReservadoAte && linha.lembreteReservadoAte >= agora;
    if (linha[Object.keys(where).find((k) => k.startsWith('lembrete2'))] || reservaViva) return { count: 0 };
    linha.lembreteReservadoAte = data.lembreteReservadoAte;
    linha.lembreteTentativas += data.lembreteTentativas.increment;
    return { count: 1 };
  };
  prisma.agendamento.update = async ({ data }) => { Object.assign(linha, data); return linha; };
  prisma.historicoAgendamento.create = async ({ data }) => { historico.push(data); return data; };
  return { linha, historico };
}

test('decidirAposFalha: passageira tenta de novo ate o limite; definitiva desiste na hora', () => {
  assert.equal(decidirAposFalha({ codigo: 'SOCKET_INDISPONIVEL', tentativas: 1 }), 'TENTAR_DE_NOVO');
  assert.equal(decidirAposFalha({ codigo: 'SOCKET_INDISPONIVEL', tentativas: MAX_TENTATIVAS }), 'DESISTIR');
  assert.equal(decidirAposFalha({ codigo: 'OPT_OUT', tentativas: 1 }), 'DESISTIR');
  assert.equal(decidirAposFalha({ codigo: 'SEM_WHATSAPP', tentativas: 1 }), 'DESISTIR');
});

test('sucesso: so marca lembrete24hEm depois do envio', async () => {
  const { linha, historico } = mockar();
  let marcadoAntesDoEnvio = null;
  const r = await processarLembretes(agora, {
    enviar: async () => { marcadoAntesDoEnvio = linha.lembrete24hEm; return { ok: true, canal: 'BAILEYS' }; },
  });
  assert.equal(marcadoAntesDoEnvio, null);
  assert.ok(linha.lembrete24hEm instanceof Date);
  assert.equal(linha.lembreteReservadoAte, null);
  assert.equal(linha.lembreteTentativas, 0);
  assert.equal(r.enviados, 1);
  assert.equal(historico[0].acao, 'LEMBRETE_ENVIADO');
});

test('socket indisponivel: nao marca, solta a reserva e tenta na proxima rodada', async () => {
  const { linha, historico } = mockar();
  const r = await processarLembretes(agora, { enviar: async () => ({ ok: false, erro: 'SOCKET_INDISPONIVEL', codigo: 'SOCKET_INDISPONIVEL' }) });
  assert.equal(linha.lembrete24hEm, null);
  assert.equal(linha.lembreteReservadoAte, null);
  assert.equal(linha.lembreteTentativas, 1);
  assert.equal(r.adiados, 1);
  assert.equal(historico.length, 0);

  // Proxima rodada: volta a tentar e agora vai.
  const r2 = await processarLembretes(agora, { enviar: async () => ({ ok: true, canal: 'BAILEYS' }) });
  assert.equal(r2.enviados, 1);
  assert.ok(linha.lembrete24hEm);
});

test('depois de MAX_TENTATIVAS falhas passageiras, desiste e registra a falha', async () => {
  const { linha, historico } = mockar({ tentativas: MAX_TENTATIVAS - 1 });
  const r = await processarLembretes(agora, { enviar: async () => ({ ok: false, erro: 'x', codigo: 'SOCKET_INDISPONIVEL' }) });
  assert.equal(r.falhas, 1);
  assert.ok(linha.lembrete24hEm); // marcado pra parar de tentar
  assert.equal(linha.lembreteTentativas, 0);
  assert.equal(historico[0].acao, 'LEMBRETE_FALHOU');
});

test('reserva viva de outro worker: nao envia de novo', async () => {
  const { linha } = mockar();
  linha.lembreteReservadoAte = new Date(agora.getTime() + 60_000);
  let enviou = false;
  await processarLembretes(agora, { enviar: async () => { enviou = true; return { ok: true }; } });
  assert.equal(enviou, false);
});
