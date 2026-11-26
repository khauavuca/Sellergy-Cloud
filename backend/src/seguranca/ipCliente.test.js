const test = require('node:test');
const assert = require('node:assert');
const { ipDoCliente, ehEnderecoInterno } = require('./ipCliente');

test('enderecos internos', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:172.18.0.1', '10.0.0.5', '192.168.1.2']) assert.equal(ehEnderecoInterno(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '', 'lixo']) assert.equal(ehEnderecoInterno(ip), false, ip);
});

test('CF-Connecting-IP so vale vindo do tunel (salto interno)', () => {
  const doTunel = { socket: { remoteAddress: '::ffff:172.18.0.1' }, headers: { 'cf-connecting-ip': '200.1.2.3' }, ip: '172.18.0.1' };
  assert.equal(ipDoCliente(doTunel), '200.1.2.3');
  const deFora = { socket: { remoteAddress: '8.8.8.8' }, headers: { 'cf-connecting-ip': '1.1.1.1' }, ip: '8.8.8.8' };
  assert.equal(ipDoCliente(deFora), '8.8.8.8');
  const lixo = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-connecting-ip': 'abc' }, ip: '127.0.0.1' };
  assert.equal(ipDoCliente(lixo), '127.0.0.1');
  // Local sem Cloudflare: X-Forwarded-For (ja aplicado em req.ip) e ignorado.
  const xffFalso = { socket: { remoteAddress: '::ffff:172.18.0.1' }, headers: {}, ip: '203.0.113.9' };
  assert.equal(ipDoCliente(xffFalso), '::ffff:172.18.0.1');
});
