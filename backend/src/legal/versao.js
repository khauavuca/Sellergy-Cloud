// Versao vigente dos Termos de uso e da Politica de privacidade (data da
// publicacao). Mudou o texto de forma relevante? Troque a data aqui e no
// frontend (src/legal/versao.js): o aceite gravado no usuario diz qual
// versao ele aceitou (prova pra LGPD).
const VERSAO_TERMOS = '2026-11-24';

/** O corpo trouxe o aceite explicito? (checkbox marcado no front) */
function aceitouTermos(corpo) {
  return corpo?.aceiteTermos === true;
}

module.exports = { VERSAO_TERMOS, aceitouTermos };
