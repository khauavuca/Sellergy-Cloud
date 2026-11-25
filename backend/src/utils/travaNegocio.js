// =====================================================================
// Trava por negocio + assunto (advisory lock do Postgres).
// =====================================================================
// Diferente de utils/locks.js (uma trava so por negocio), aqui a chave junta
// um assunto ('equipe', 'importacao'...) com o clienteId: importar planilha
// nao espera o caixa, e criar usuario/convite do mesmo negocio fica em fila.
//
//   await prisma.$transaction(async (tx) => {
//     await travarNegocio(tx, 'equipe', clienteId);       // espera a vez
//     ... contar e criar ...
//   });
//
//   if (!(await tentarTravarNegocio(tx, 'importacao', clienteId))) -> 409
// =====================================================================

const crypto = require('crypto');

/** Chave bigint (63 bits) estavel pra assunto + negocio. PURA. */
function chaveTrava(assunto, clienteId) {
  if (!assunto || !clienteId) throw new Error('travaNegocio: assunto e clienteId obrigatorios.');
  const hash = crypto.createHash('sha256').update(`${assunto}:${clienteId}`).digest();
  return hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
}

/** Espera a trava (dura ate o fim da transacao). Use dentro de $transaction. */
async function travarNegocio(tx, assunto, clienteId) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${chaveTrava(assunto, clienteId).toString()})`);
}

/** Tenta pegar a trava sem esperar. true = pegou. Use dentro de $transaction. */
async function tentarTravarNegocio(tx, assunto, clienteId) {
  const r = await tx.$queryRawUnsafe(`SELECT pg_try_advisory_xact_lock(${chaveTrava(assunto, clienteId).toString()}) AS ok`);
  return r?.[0]?.ok === true;
}

module.exports = { chaveTrava, travarNegocio, tentarTravarNegocio };
