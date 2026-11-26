// Limite de respostas automaticas por contato (janela deslizante de 1 hora).
// Protege contra loop com outro robo: dois bots respondendo um ao outro
// gastariam IA (e o chip do cliente) sem parar.
//
// Em memoria, por processo: o canal oficial responde no processo da API e o
// QR Code no worker — o mesmo bot nunca atende nos dois, entao a contagem por
// bot+telefone fica num processo so. Reiniciar zera a contagem (aceitavel:
// o limite e anti-loop, nao cobranca).
//
// Variaveis de ambiente:
//   IA_LIMITE_RESPOSTAS_POR_CONTATO_HORA   (padrao 20) — respostas com IA
//   BOT_LIMITE_RESPOSTAS_POR_CONTATO_HORA  (padrao 30) — respostas sem IA (menu/fallback)

const HORA_MS = 60 * 60 * 1000;
const MAX_CHAVES = 20_000;

function inteiroEnv(nome, padrao) {
  const n = Number(process.env[nome]);
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

function limiteIAPorContato() { return inteiroEnv('IA_LIMITE_RESPOSTAS_POR_CONTATO_HORA', 20); }
function limiteBotPorContato() { return inteiroEnv('BOT_LIMITE_RESPOSTAS_POR_CONTATO_HORA', 30); }

/**
 * @param {{ janelaMs?: number, agora?: () => number }} [opts]
 */
function criarLimitador({ janelaMs = HORA_MS, agora = () => Date.now() } = {}) {
  const registros = new Map(); // chave -> timestamps (ms) dentro da janela

  function podar(chave, t) {
    const lista = (registros.get(chave) || []).filter((x) => t - x < janelaMs);
    if (lista.length === 0) registros.delete(chave);
    else registros.set(chave, lista);
    return lista;
  }

  function faxina(t) {
    if (registros.size <= MAX_CHAVES) return;
    for (const chave of [...registros.keys()]) podar(chave, t);
  }

  return {
    /** Registra e devolve true se ainda cabe no limite; false se estourou. */
    tentar(chave, limite) {
      const t = agora();
      faxina(t);
      const lista = podar(chave, t);
      if (lista.length >= limite) return false;
      lista.push(t);
      registros.set(chave, lista);
      return true;
    },
    /** Quantas respostas ja foram dadas na janela (sem registrar). */
    contar(chave) {
      return podar(chave, agora()).length;
    },
    limpar() { registros.clear(); },
  };
}

function digitos(telefone) {
  return String(telefone || '').replace(/\D/g, '');
}

const limitadorIA = criarLimitador();
const limitadorBot = criarLimitador();

/** Pode responder com IA a este contato? (registra a resposta se sim) */
function permitirRespostaIA(botId, telefone) {
  return limitadorIA.tentar(`${botId}:${digitos(telefone)}`, limiteIAPorContato());
}

/** Pode mandar resposta automatica sem IA (menu/fallback) a este contato? */
function permitirRespostaBot(botId, telefone) {
  return limitadorBot.tentar(`${botId}:${digitos(telefone)}`, limiteBotPorContato());
}

module.exports = {
  criarLimitador,
  permitirRespostaIA,
  permitirRespostaBot,
  limiteIAPorContato,
  limiteBotPorContato,
  _limitadores: { limitadorIA, limitadorBot },
};
