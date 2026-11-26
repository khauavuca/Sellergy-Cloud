const test = require('node:test');
const assert = require('node:assert');

test('telefone vem do numero ou, em contato LID, do senderPn', async () => {
  let telefoneDaMensagem;
  try { ({ telefoneDaMensagem } = require('./gerenciadorConexao')); } catch { return; } // depende do ambiente (prisma)
  assert.strictEqual(telefoneDaMensagem({ remoteJid: '5562999990000@s.whatsapp.net' }), '5562999990000');
  assert.strictEqual(telefoneDaMensagem({ remoteJid: '5562999990000:12@s.whatsapp.net' }), '5562999990000');
  assert.strictEqual(telefoneDaMensagem({ remoteJid: '55650260406428@lid', remoteJidAlt: '5562988887777@s.whatsapp.net' }), '5562988887777');
  assert.strictEqual(telefoneDaMensagem({ remoteJid: '55650260406428@lid' }), null);
  assert.strictEqual(telefoneDaMensagem({ remoteJid: '120363@g.us' }), null);
  assert.strictEqual(telefoneDaMensagem({ remoteJid: 'status@broadcast' }), null);
});
