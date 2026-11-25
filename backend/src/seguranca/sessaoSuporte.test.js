// middlewareAutenticacao com o token da sessao de suporte: so leitura.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-sessao-suporte';
const middlewareAutenticacao = require('../middlewares/auth.middleware');
const { SEGREDO_JWT } = require('../middlewares/auth.middleware');
const { criarTokenSuporte } = require('./sessaoSuporte');

// O middleware confere o usuario no banco (seguranca/sessaoUsuario.js): aqui
// o "banco" e o Redis sao falsos, com o dono do negocio u1 existindo.
const sessaoUsuario = require('./sessaoUsuario');
sessaoUsuario._definirPrisma({ usuario: { findUnique: async ({ where }) => (where.id === 'u1' ? { id: 'u1', perfil: 'CLIENT', clienteId: 'c1', versaoSessao: 0, permissoes: {} } : null) } });
sessaoUsuario._definirRedis({ exists: async () => 0, set: async () => 'OK' });

function chamar(metodo, url, token) {
  return new Promise((resolve) => {
    const req = { method: metodo, originalUrl: url, headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(corpo) { resolve({ status: this.statusCode, corpo, req }); },
    };
    middlewareAutenticacao(req, res, () => resolve({ status: 'next', req }));
  });
}

const { token } = criarTokenSuporte({
  segredo: SEGREDO_JWT,
  usuarioAlvo: { id: 'u1', perfil: 'CLIENT', clienteId: 'c1' },
  admin: { id: 'a1', nome: 'Ana' },
  clienteNome: 'Loja',
});

test('sessao de suporte: GET passa com o claim do admin', async () => {
  const r = await chamar('GET', '/vendas?pagina=1', token);
  assert.equal(r.status, 'next');
  assert.equal(r.req.usuario.clienteId, 'c1');
  assert.equal(r.req.usuario.suporte.adminId, 'a1');
});

test('sessao de suporte: qualquer escrita e barrada com 403', async () => {
  for (const [m, u] of [['POST', '/vendas'], ['PUT', '/catalogo/produtos/1'], ['PATCH', '/agenda/1'], ['DELETE', '/clientes/1'], ['POST', '/autenticacao/trocar-senha'], ['POST', '/suporte/chamados']]) {
    const r = await chamar(m, u, token);
    assert.equal(r.status, 403, `${m} ${u}`);
    assert.equal(r.corpo.codigo, 'SESSAO_SUPORTE_SO_LEITURA');
  }
});

test('sessao de suporte: encerrar a propria sessao passa', async () => {
  const r = await chamar('POST', '/suporte/sessao/encerrar', token);
  assert.equal(r.status, 'next');
});

test('token adulterado ou de outro segredo nao entra', async () => {
  const { token: falso } = criarTokenSuporte({ segredo: 'outro', usuarioAlvo: { id: 'u1', perfil: 'CLIENT', clienteId: 'c1' }, admin: { id: 'a1' } });
  const r = await chamar('GET', '/vendas', falso);
  assert.equal(r.status, 401);
});
