// =====================================================================
// NUMEROS VINDOS DA TELA (padrao brasileiro)
// =====================================================================
// Use SEMPRE no lugar de parseFloat/parseInt em valor, preco, quantidade.
// parseFloat("10,50") da 10 (corta calado). Aqui:
//   paraNumero("10,50")     -> 10.5
//   paraNumero("1.234,56")  -> 1234.56
//   paraNumero(10.5)        -> 10.5
//   paraNumero("abc")       -> NaN   (quem chama decide a mensagem)
// =====================================================================

/** Converte texto/numero em Number aceitando virgula decimal. PURA. */
function paraNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
  if (typeof valor !== 'string') return NaN;
  let t = valor.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) {
    // "1.234,56" -> pontos sao milhar; virgula e decimal.
    t = t.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

/** Dinheiro: numero finito, arredondado em centavos, dentro de [min, max]. */
function lerDinheiro(valor, { min = 0, max = 10_000_000 } = {}) {
  const n = paraNumero(valor);
  if (!Number.isFinite(n)) return { ok: false, erro: 'Valor inválido.' };
  const v = Math.round(n * 100) / 100;
  if (v < min) return { ok: false, erro: min === 0 ? 'O valor não pode ser negativo.' : `O valor mínimo é ${min}.` };
  if (v > max) return { ok: false, erro: `O valor máximo é ${max.toLocaleString('pt-BR')}.` };
  return { ok: true, valor: v };
}

/** Quantidade inteira dentro de [min, max]. "2,5" e 2.5 sao recusados. */
function lerInteiro(valor, { min = 1, max = 100_000 } = {}) {
  const n = paraNumero(valor);
  if (!Number.isInteger(n)) return { ok: false, erro: 'Use um número inteiro.' };
  if (n < min) return { ok: false, erro: `O mínimo é ${min}.` };
  if (n > max) return { ok: false, erro: `O máximo é ${max.toLocaleString('pt-BR')}.` };
  return { ok: true, valor: n };
}

module.exports = { paraNumero, lerDinheiro, lerInteiro };
