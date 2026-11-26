// Tela Admin › Integracoes: rotas das chaves da plataforma e a tabela por cliente.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const prisma = require('../prisma');

function stubModulo(relativo, exportsFalsos) {
  const caminho = require.resolve(path.join(__dirname, relativo));
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: exportsFalsos };
}
stubModulo('../middlewares/auth.middleware', (req, _res, next) => { req.usuario = { id: 'a1', perfil: 'ADMIN' }; next(); });
stubModulo('../middlewares/permissoes.middleware', { requerAdmin: (_req, _res, next) => next(), ehAdmin: () => true });
const credenciais = require('../credenciais');
const salvos = [];
credenciais.salvarCredencialPlataforma = async (p) => { salvos.push(p); return { id: 'cp1', tipo: p.tipo, nome: p.nome, dadosCifrados: 'x', iv: 'y', tag: 'z' }; };
let segredoDoBot = null;
credenciais.carregarCredencialDecifrada = async () => ({ dados: segredoDoBot ? { accessToken: 't', appSecret: segredoDoBot } : { accessToken: 't' } });

const rotas = require('./admin-credencial-ia.routes');
const { situacaoWhatsapp } = rotas;

let base; let servidor;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/admin/plataforma', rotas);
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}/admin/plataforma`;
});
test.after(() => servidor?.close());

test('situacao do WhatsApp: cada caso vira um rotulo claro', () => {
  assert.equal(situacaoWhatsapp(null).rotulo, 'Sem bot');
  assert.equal(situacaoWhatsapp({ provedorCanal: 'BAILEYS', statusConexaoBaileys: 'CONECTADO' }).rotulo, 'QR Code');
  assert.equal(situacaoWhatsapp({ provedorCanal: 'BAILEYS', statusConexaoBaileys: 'DESCONECTADO' }).tom, 'alerta');
  assert.equal(situacaoWhatsapp({ provedorCanal: 'META_CLOUD' }).rotulo, 'Não conectado');
  const oficial = { provedorCanal: 'META_CLOUD', identificadorCanal: '1', credencialCanalId: 'c' };
  assert.equal(situacaoWhatsapp(oficial, false).rotulo, 'Oficial · falta segredo');
  assert.equal(situacaoWhatsapp(oficial, true).rotulo, 'Oficial · falta webhook');
  assert.equal(situacaoWhatsapp({ ...oficial, webhookConfirmadoEm: new Date() }, true).rotulo, 'Oficial');
});

test('chaves da plataforma: lista as 3, sem segredo', async () => {
  prisma.credencial.findMany = async () => [{ id: 'k1', tipo: 'DEEPSEEK_KEY', nome: 'DeepSeek', criadoEm: new Date(), atualizadoEm: new Date() }];
  const r = await fetch(`${base}/credenciais`);
  const j = await r.json();
  assert.deepEqual(j.map((x) => [x.tipo, x.configurada]), [['DEEPSEEK_KEY', true], ['FOCUS_NFE_KEY', false]]);
  assert.ok(!JSON.stringify(j).includes('dadosCifrados'));
});

test('salvar chave: so os campos do tipo; tipo de cliente (pagamento/WhatsApp) e recusado', async () => {
  salvos.length = 0;
  let r = await fetch(`${base}/credenciais/FOCUS_NFE_KEY`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dados: { token: ' tok-revenda ', extra: 'x' } }) });
  assert.equal(r.status, 200);
  assert.deepEqual(salvos[0].payload, { token: 'tok-revenda' });
  assert.ok(!JSON.stringify(await r.json()).includes('dadosCifrados'));
  r = await fetch(`${base}/credenciais/FOCUS_NFE_KEY`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dados: {} }) });
  assert.equal(r.status, 400);
  for (const tipo of ['MERCADO_PAGO_KEY', 'WHATSAPP_CLOUD_TOKEN', 'NUVEM_FISCAL_KEY']) {
    r = await fetch(`${base}/credenciais/${tipo}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dados: { accessToken: 'x' } }) });
    assert.equal(r.status, 404, tipo);
  }
});

test('por cliente: junta bot, notas, IA e pagamento', async () => {
  segredoDoBot = null;
  prisma.cliente.findMany = async () => [{ id: 'c1', nome: 'Lumi', status: 'ACTIVE' }, { id: 'c2', nome: 'Aria', status: 'ACTIVE' }];
  prisma.bot.findMany = async () => [{ clienteId: 'c1', provedorCanal: 'META_CLOUD', identificadorCanal: '1', credencialCanalId: 'cr', iaAtiva: true }];
  prisma.configuracaoFiscal.findMany = async () => [{ clienteId: 'c2', credencialId: 'cf', ativo: true, ambiente: 'PRODUCAO' }];
  prisma.credencial.findMany = async ({ where }) => (where.descricao ? [] : [{ clienteId: 'c1', tipo: 'MERCADO_PAGO_KEY' }]);
  const j = await (await fetch(`${base}/integracoes/clientes`)).json();
  const lumi = j.clientes.find((c) => c.nome === 'Lumi');
  const aria = j.clientes.find((c) => c.nome === 'Aria');
  assert.equal(lumi.whatsapp.rotulo, 'Oficial · falta segredo');
  assert.equal(lumi.ia.rotulo, 'Ligada');
  assert.equal(lumi.pagamento.rotulo, 'Mercado Pago');
  assert.equal(aria.whatsapp.rotulo, 'Sem bot');
  assert.equal(aria.notas.rotulo, 'Chave própria');
  assert.equal(lumi.notas.rotulo, 'Não ativou');
  assert.equal(aria.pagamento.rotulo, 'Não configurado');
  assert.deepEqual(j.totais, { clientes: 2, iaLigada: 1, oficialConectado: 0, oficialPendente: 1, semPagamento: 1 });
});
