const test = require('node:test');
const assert = require('node:assert/strict');
const { papelPode, papelDe, escritaLiberadaPara, acoesDoPapel, papelParaBanco, MATRIZ } = require('./papeis');
const { requisicaoPermitidaEmSuporte, criarTokenSuporte, DURACAO_MIN } = require('./sessaoSuporte');
const jwt = require('jsonwebtoken');

test('papel null/vazio no banco e o dono; valor desconhecido fecha o acesso', () => {
  assert.equal(papelDe(null), 'DONO');
  assert.equal(papelDe(undefined), 'DONO');
  assert.equal(papelDe('SUPORTE'), 'SUPORTE');
  assert.equal(papelDe('qualquer'), 'DESATIVADO');
  assert.equal(papelParaBanco('DONO'), null);
  assert.equal(papelParaBanco('FINANCEIRO'), 'FINANCEIRO');
});

test('matriz do prototipo: suporte, financeiro e dono', () => {
  // Ver clientes e uso: todos
  for (const p of ['DONO', 'SUPORTE', 'FINANCEIRO']) {
    assert.ok(papelPode(p, 'clientes.ver'));
    assert.ok(papelPode(p, 'uso.ver'));
  }
  // Entrar como suporte e responder chamados: dono e suporte
  assert.ok(papelPode('SUPORTE', 'suporte.entrar'));
  assert.ok(papelPode('SUPORTE', 'suporte.responder'));
  assert.ok(!papelPode('FINANCEIRO', 'suporte.entrar'));
  assert.ok(!papelPode('FINANCEIRO', 'suporte.responder'));
  // Baixa, desconto e mudar plano: dono e financeiro
  for (const a of ['cobranca.baixa', 'cobranca.desconto', 'plano.mudar']) {
    assert.ok(papelPode('FINANCEIRO', a), a);
    assert.ok(!papelPode('SUPORTE', a), a);
    assert.ok(papelPode('DONO', a), a);
  }
  // Suspender, cancelar, precos e equipe: so o dono
  for (const a of ['conta.suspender', 'conta.cancelar', 'precos.editar', 'equipe.gerenciar', 'auditoria.ver', 'comunicados.enviar']) {
    assert.ok(papelPode('DONO', a), a);
    assert.ok(!papelPode('SUPORTE', a), a);
    assert.ok(!papelPode('FINANCEIRO', a), a);
  }
  // Desativado nao faz nada
  for (const a of Object.keys(MATRIZ)) assert.ok(!papelPode('DESATIVADO', a), a);
  assert.deepEqual(acoesDoPapel('DESATIVADO'), []);
  assert.equal(acoesDoPapel('DONO').length, Object.keys(MATRIZ).length);
});

test('acao inexistente quebra (erro de digitacao aparece no boot)', () => {
  assert.throws(() => papelPode('DONO', 'cobranca.inventada'));
});

test('escrita por prefixo: suporte e financeiro so nas suas areas', () => {
  assert.ok(escritaLiberadaPara('DONO', '/clientes/123'));
  assert.ok(escritaLiberadaPara('SUPORTE', '/admin/suporte/chamados/1/responder'));
  assert.ok(escritaLiberadaPara('SUPORTE', '/autenticacao/2fa/ativar'));
  assert.ok(!escritaLiberadaPara('SUPORTE', '/admin/assinaturas/faturas/1/pagar'));
  assert.ok(!escritaLiberadaPara('SUPORTE', '/clientes/123'));
  assert.ok(!escritaLiberadaPara('SUPORTE', '/admin/suportex'));
  assert.ok(escritaLiberadaPara('FINANCEIRO', '/admin/assinaturas/faturas/1/pagar'));
  assert.ok(!escritaLiberadaPara('FINANCEIRO', '/admin/planos/PRO'));
  assert.ok(!escritaLiberadaPara('FINANCEIRO', '/usuarios'));
  assert.ok(!escritaLiberadaPara('DESATIVADO', '/autenticacao/logout'));
});

test('modo suporte: so leitura, exceto encerrar a propria sessao', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.ok(requisicaoPermitidaEmSuporte(m, '/vendas'));
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(!requisicaoPermitidaEmSuporte(m, '/vendas'), m);
    assert.ok(!requisicaoPermitidaEmSuporte(m, '/autenticacao/trocar-senha'), m);
    assert.ok(!requisicaoPermitidaEmSuporte(m, '/suporte/chamados'), m);
  }
  assert.ok(requisicaoPermitidaEmSuporte('POST', '/suporte/sessao/encerrar'));
  assert.ok(requisicaoPermitidaEmSuporte('POST', '/suporte/sessao/encerrar?x=1'));
  assert.ok(requisicaoPermitidaEmSuporte('POST', '/autenticacao/logout'));
  assert.ok(!requisicaoPermitidaEmSuporte('POST', '/suporte/sessao/encerrar/outra'));
});

test('token de suporte: claim do admin, alvo do tenant e 30 min', () => {
  const agora = Date.now();
  const { token, sessaoId, expiraEm } = criarTokenSuporte({
    segredo: 'segredo-de-teste',
    usuarioAlvo: { id: 'u1', perfil: 'CLIENT', clienteId: 'c1' },
    admin: { id: 'a1', nome: 'Ana' },
    clienteNome: 'Loja X',
    agora,
  });
  const d = jwt.verify(token, 'segredo-de-teste');
  assert.equal(d.id, 'u1');
  assert.equal(d.perfil, 'CLIENT');
  assert.equal(d.clienteId, 'c1');
  assert.equal(d.suporte.adminId, 'a1');
  assert.equal(d.suporte.sessaoId, sessaoId);
  assert.ok(Math.abs(d.exp - d.iat - DURACAO_MIN * 60) <= 1);
  assert.ok(Math.abs(expiraEm.getTime() - (agora + 30 * 60 * 1000)) < 5);
  assert.throws(() => criarTokenSuporte({ segredo: 's', usuarioAlvo: { id: 'u' }, admin: { id: 'a' } }));
});
