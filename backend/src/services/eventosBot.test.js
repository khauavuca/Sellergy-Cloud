const test = require('node:test');
const assert = require('node:assert');
const { botParaEvento, emitirEventoBot } = require('./eventosBot');

function ioFalso() {
  const chamadas = [];
  const io = {
    salas: [],
    to(sala) { this.salas.push(sala); return this; },
    emit(evento, dados) { chamadas.push({ salas: [...this.salas], evento, dados }); this.salas = []; },
  };
  return { io, chamadas };
}

const bot = {
  id: 'b1', clienteId: 'c1', nome: 'WhatsApp', status: 'ONLINE',
  qrCodeAtual: 'data:image/png;base64,QR', verifyTokenCanal: 'token-secreto', iaPromptSistema: 'regras internas',
};

test('evento do bot sai sem QR, verify token e prompt da IA', () => {
  const limpo = botParaEvento(bot);
  assert.equal(limpo.qrCodeAtual, undefined);
  assert.equal(limpo.verifyTokenCanal, undefined);
  assert.equal(limpo.iaPromptSistema, undefined);
  assert.equal(limpo.nome, 'WhatsApp');
  assert.equal(bot.qrCodeAtual, 'data:image/png;base64,QR'); // nao muta o original
});

test('emite so pra sala do negocio e admins, nunca global', () => {
  const { io, chamadas } = ioFalso();
  emitirEventoBot(io, 'bot_atualizado', 'c1', bot);
  assert.equal(chamadas.length, 1);
  assert.deepEqual(chamadas[0].salas, ['cliente:c1', 'admins']);
  assert.equal(chamadas[0].dados.verifyTokenCanal, undefined);
});

test('bot_deletado manda so o id; sem io ou sem clienteId nao emite', () => {
  const { io, chamadas } = ioFalso();
  emitirEventoBot(io, 'bot_deletado', 'c1', 'b1');
  assert.equal(chamadas[0].dados, 'b1');
  emitirEventoBot(undefined, 'bot_atualizado', 'c1', bot);
  emitirEventoBot(io, 'bot_atualizado', null, bot);
  assert.equal(chamadas.length, 1);
});
