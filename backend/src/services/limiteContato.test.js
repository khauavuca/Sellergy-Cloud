const test = require('node:test');
const assert = require('node:assert');
const { criarLimitador, permitirRespostaIA, permitirRespostaBot, limiteIAPorContato, limiteBotPorContato } = require('./limiteContato');

test('limitador: deixa ate N por janela e libera quando a janela passa', () => {
  let t = 0;
  const lim = criarLimitador({ janelaMs: 1000, agora: () => t });
  assert.equal(lim.tentar('a', 2), true);
  assert.equal(lim.tentar('a', 2), true);
  assert.equal(lim.tentar('a', 2), false); // 3a na mesma janela
  assert.equal(lim.tentar('b', 2), true); // outro contato nao e afetado
  t = 1001;
  assert.equal(lim.tentar('a', 2), true); // janela deslizou
  assert.equal(lim.contar('a'), 1);
});

test('limites padrao e por env', () => {
  delete process.env.IA_LIMITE_RESPOSTAS_POR_CONTATO_HORA;
  delete process.env.BOT_LIMITE_RESPOSTAS_POR_CONTATO_HORA;
  assert.equal(limiteIAPorContato(), 20);
  assert.equal(limiteBotPorContato(), 30);
  process.env.IA_LIMITE_RESPOSTAS_POR_CONTATO_HORA = '3';
  process.env.BOT_LIMITE_RESPOSTAS_POR_CONTATO_HORA = 'abc'; // invalido -> padrao
  assert.equal(limiteIAPorContato(), 3);
  assert.equal(limiteBotPorContato(), 30);
});

test('permitirRespostaIA: telefone com e sem mascara conta como o mesmo contato', () => {
  process.env.IA_LIMITE_RESPOSTAS_POR_CONTATO_HORA = '2';
  assert.equal(permitirRespostaIA('bot-x', '+55 (11) 98888-7777'), true);
  assert.equal(permitirRespostaIA('bot-x', '5511988887777'), true);
  assert.equal(permitirRespostaIA('bot-x', '5511988887777'), false);
  assert.equal(permitirRespostaIA('bot-y', '5511988887777'), true); // outro bot, outra conta
});

test('permitirRespostaBot (sem IA) tem contagem propria', () => {
  process.env.BOT_LIMITE_RESPOSTAS_POR_CONTATO_HORA = '1';
  assert.equal(permitirRespostaBot('bot-z', '5511900000000'), true);
  assert.equal(permitirRespostaBot('bot-z', '5511900000000'), false);
});
