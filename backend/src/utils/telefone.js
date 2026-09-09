// Normalizacao de telefone pra busca por indice (Lead.telefoneNormalizado).
//
// O problema: o lead e cadastrado como o usuario digitou ("(11) 99999-8888",
// "11999998888", as vezes ate com o 55), e o remetente de uma mensagem do
// WhatsApp chega sempre como 55 + DDD + numero. Antes, casar os dois exigia
// carregar TODOS os leads do tenant e comparar sufixo em JS a cada mensagem.
// Com uma forma canonica gravada no banco (e indexada), vira 1 busca por
// igualdade.
//
// Forma canonica = so digitos, sem o DDI 55 (DDD + numero, 10-11 digitos).
// Funcoes puras — testadas em telefone.test.js.

function normalizarTelefone(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  // 12-13 digitos comecando com 55 = DDI + DDD + numero (8 ou 9 digitos).
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    return digitos.slice(2);
  }
  return digitos;
}

/**
 * Valores a procurar em `telefoneNormalizado` pra achar o lead de um
 * remetente. Alem da forma canonica, tenta os sufixos de 9 e 8 digitos —
 * cobre lead gravado sem DDD, ou sem o nono digito. Mesma tolerancia que a
 * comparacao antiga por sufixo tinha, so que por igualdade indexada.
 * @param {string} telefoneRemetente
 * @returns {string[]}
 */
function candidatosDeBusca(telefoneRemetente) {
  const canonico = normalizarTelefone(telefoneRemetente);
  if (!canonico) return [];
  const candidatos = new Set([canonico]);
  if (canonico.length > 9) candidatos.add(canonico.slice(-9));
  if (canonico.length > 8) candidatos.add(canonico.slice(-8));
  return [...candidatos].filter((c) => c.length >= 8);
}

module.exports = { normalizarTelefone, candidatosDeBusca };
