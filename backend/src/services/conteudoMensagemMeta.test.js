const test = require('node:test');
const assert = require('node:assert');
const { lerConteudoMeta } = require('./conteudoMensagemMeta');

test('webhook da Meta: tipos de mensagem viram o tipo do sistema', () => {
  assert.strictEqual(lerConteudoMeta({ type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'x' } }).tipo, 'IMAGEM');
  assert.strictEqual(lerConteudoMeta({ type: 'audio', audio: { id: 'm2', voice: true } }).tipo, 'VOZ');
  assert.strictEqual(lerConteudoMeta({ type: 'audio', audio: { id: 'm3' } }).tipo, 'AUDIO');
  assert.strictEqual(lerConteudoMeta({ type: 'document', document: { id: 'm4', filename: 'nf.pdf' } }).midia.nome, 'nf.pdf');
  assert.strictEqual(lerConteudoMeta({ type: 'sticker', sticker: { id: 'm5' } }).tipo, 'FIGURINHA');
  assert.strictEqual(lerConteudoMeta({ type: 'location', location: { latitude: 1, longitude: 2 } }).extra.lng, 2);
  assert.deepStrictEqual(lerConteudoMeta({ type: 'contacts', contacts: [{ name: { formatted_name: 'Ana' }, phones: [{ wa_id: '5562999990000' }] }] }).extra.contatos[0], { nome: 'Ana', telefones: ['5562999990000'] });
  assert.strictEqual(lerConteudoMeta({ type: 'reaction', reaction: { emoji: '👍', message_id: 'w1' } }).extra.alvo, 'w1');
  assert.strictEqual(lerConteudoMeta({ type: 'image', image: { id: 'm1' }, context: { id: 'w9' } }).respondeAId, 'w9');
  assert.strictEqual(lerConteudoMeta({ type: 'text', text: { body: 'oi' } }), null);
});
