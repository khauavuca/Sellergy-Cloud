// =====================================================================
// IP do visitante para limites de tentativa (login, 2FA).
// =====================================================================
// A API fica no localhost e chega na internet pelo tunel do Cloudflare. O
// Cloudflare grava o IP real em CF-Connecting-IP (e sobrescreve o que o
// visitante mandar). So aceitamos esse cabecalho quando o pedido veio de um
// salto interno (loopback / rede do Docker), ou seja, do proprio tunel: quem
// chamasse a API por fora nao consegue inventar um IP novo a cada tentativa.
// =====================================================================

const net = require('net');

/** Endereco de loopback, link-local ou rede privada (onde roda o tunel). PURA. */
function ehEnderecoInterno(ip) {
  let a = String(ip || '').trim().toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (!a) return false;
  if (net.isIPv4(a)) {
    const [p1, p2] = a.split('.').map(Number);
    return p1 === 127 || p1 === 10 || (p1 === 172 && p2 >= 16 && p2 <= 31)
      || (p1 === 192 && p2 === 168) || (p1 === 169 && p2 === 254);
  }
  if (net.isIPv6(a)) return a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
  return false;
}

/** IP que identifica o visitante. PURA (recebe o req). */
function ipDoCliente(req) {
  const salto = req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
  const cf = String(req?.headers?.['cf-connecting-ip'] || '').trim();
  if (ehEnderecoInterno(salto)) {
    if (cf && net.isIP(cf.replace(/^::ffff:/, ''))) return cf;
    // Salto interno sem o cabecalho do Cloudflare: o pedido nao veio pelo
    // tunel (e da propria maquina/rede). X-Forwarded-For ai e inventavel:
    // conta pelo endereco de quem conectou.
    return salto;
  }
  return req?.ip || salto || 'desconhecido';
}

module.exports = { ipDoCliente, ehEnderecoInterno };
