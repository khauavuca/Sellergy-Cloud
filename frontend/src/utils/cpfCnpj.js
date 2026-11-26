// =====================================================================
// CPF / CNPJ de quem paga (cobranca pelo Asaas)
// =====================================================================
// Mascara progressiva (CPF ate 11 digitos, CNPJ com 12 a 14) e validacao do
// digito verificador — mesma regra de backend/src/utils/validacaoFiscal.js,
// que confere de novo no servidor.

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

export function formatarCpfCnpj(valor) {
  const d = soDigitos(valor).slice(0, 14);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function cpfOk(cpf) {
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (qtd) => {
    let soma = 0;
    for (let i = 0; i < qtd; i++) soma += Number(cpf[i]) * (qtd + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function cnpjOk(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += Number(cnpj[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(cnpj[12])
    && calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(cnpj[13]);
}

/** true quando e um CPF ou CNPJ com digito verificador valido. */
export function cpfCnpjValido(valor) {
  const d = soDigitos(valor);
  return d.length === 11 ? cpfOk(d) : d.length === 14 ? cnpjOk(d) : false;
}

/** Mensagem de erro do campo (null = ok). `obrigatorio` = provedor exige. */
export function erroCpfCnpj(valor, obrigatorio) {
  const d = soDigitos(valor);
  if (!d) return obrigatorio ? 'Informe o CPF ou CNPJ de quem vai pagar.' : null;
  return cpfCnpjValido(d) ? null : 'CPF ou CNPJ inválido. Confira os números.';
}

export const limparCpfCnpj = soDigitos;
