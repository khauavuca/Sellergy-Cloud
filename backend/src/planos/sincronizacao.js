// =====================================================================
// SINCRONIZACAO DO PRECO/LIMITE DOS PLANOS (PlanoConfig -> cache em memoria)
// =====================================================================
// catalogo.js#obterPlano e sincrono e le um cache em memoria. Este modulo
// mantem o cache igual ao banco:
//
//   - no boot: routes/adminPlanos.routes.js (API) e admin/tarefasAdmin.js
//     (worker) chamam iniciarSincronizacao();
//   - ao salvar: a rota chama recarregarPlanos() e publicarMudanca();
//   - outros processos (worker, 2a instancia da API): recebem o aviso pelo
//     Redis pub/sub (canal sellergy:planos) e recarregam na hora; se o Redis
//     cair, a recarga de 5 em 5 minutos garante que ninguem fica pra tras.
// =====================================================================

const { aplicarOverrides } = require('./catalogo');

const CANAL = 'sellergy:planos';
const INTERVALO_MS = 5 * 60 * 1000;

let iniciado = false;

async function recarregarPlanos() {
  const prisma = require('../prisma');
  const linhas = await prisma.planoConfig.findMany();
  aplicarOverrides(linhas);
  return linhas;
}

async function publicarMudanca() {
  let pub = null;
  try {
    const { criarConexaoRedis } = require('../filas');
    pub = criarConexaoRedis();
    await pub.publish(CANAL, String(Date.now()));
  } catch (e) {
    console.error('[planos] aviso pelo Redis falhou (os outros processos recarregam em ate 5 min)', e?.message);
  } finally {
    if (pub) pub.quit().catch(() => {});
  }
}

/** Liga a sincronizacao uma vez por processo. Nao roda dentro do node --test. */
function iniciarSincronizacao() {
  if (iniciado || process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') return;
  iniciado = true;
  recarregarPlanos().catch((e) => console.error('[planos] carga inicial falhou (vale o preco do codigo)', e?.message));
  setInterval(() => {
    recarregarPlanos().catch((e) => console.error('[planos] recarga falhou', e?.message));
  }, INTERVALO_MS).unref();
  try {
    const { criarConexaoRedis } = require('../filas');
    const sub = criarConexaoRedis();
    sub.on('error', () => {}); // ioredis ja reconecta sozinho; evita log repetido
    sub.subscribe(CANAL).catch((e) => console.error('[planos] assinatura do canal falhou', e?.message));
    sub.on('message', (canal) => {
      if (canal !== CANAL) return;
      recarregarPlanos().catch((e) => console.error('[planos] recarga por aviso falhou', e?.message));
    });
  } catch (e) {
    console.error('[planos] pub/sub indisponivel', e?.message);
  }
}

module.exports = { recarregarPlanos, publicarMudanca, iniciarSincronizacao, CANAL };
