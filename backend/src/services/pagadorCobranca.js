// Quem paga a cobranca (pagador) — regra unica do CPF/CNPJ.
//
// O Asaas nao cria cobranca sem um customer, e o customer exige CPF/CNPJ.
// Regra: com provedor ASAAS, usa o CPF/CNPJ informado na tela (se valido) ou
// o do lead/cliente; sem nenhum dos dois, recusa ANTES de criar a Cobranca
// (422 PAGADOR_SEM_CPF), pra tela pedir o campo e o bot pedir ao cliente.
// Nunca inventa CPF. Os outros provedores aceitam sem documento.

const { validarDocumento } = require('../utils/validacaoFiscal');

const PROVEDORES_QUE_EXIGEM_CPF = new Set(['ASAAS']);

const soDigitos = (v) => String(v ?? '').replace(/\D+/g, '');

/** O provedor pede CPF/CNPJ de quem paga? */
function exigeCpfCnpj(provedor) {
  return PROVEDORES_QUE_EXIGEM_CPF.has(String(provedor || '').toUpperCase());
}

/** Digitos do CPF/CNPJ se tiver digito verificador valido; senao null. */
function cpfCnpjValido(v) {
  const d = soDigitos(v);
  if (!d) return null;
  return validarDocumento(d) ? d : null;
}

function erroSemCpf() {
  return Object.assign(new Error('Informe o CPF ou CNPJ de quem vai pagar. O Asaas exige esse dado.'), {
    status: 422, codigo: 'PAGADOR_SEM_CPF', campos: ['cpfCnpj'],
  });
}

function erroCpfInvalido() {
  return Object.assign(new Error('CPF ou CNPJ inválido. Confira os números.'), {
    status: 422, codigo: 'CPF_CNPJ_INVALIDO', campos: ['cpfCnpj'],
  });
}

/**
 * Monta o pagador final a partir do que veio da tela/fluxo e do lead.
 * - CPF/CNPJ digitado e invalido -> erro (nao cai silenciosamente pro do lead).
 * - Sem CPF digitado -> usa o do lead, se valido.
 * - Provedor que exige e ainda sem documento (e sem customer pronto) -> erro.
 * @param {{provedor:string, pagador?:Object, lead?:{nome?:string, telefone?:string, email?:string, cpf?:string}|null}} p
 * @returns {{pagador:Object, cpfNovoDoLead:string|null}} cpfNovoDoLead = CPF
 *   digitado que vale gravar no lead (lead sem CPF), pra nao pedir de novo.
 */
function resolverPagador({ provedor, pagador, lead }) {
  const base = { ...(pagador || {}) };
  const digitado = soDigitos(base.cpfCnpj);
  let cpfCnpj = null;
  if (digitado) {
    cpfCnpj = cpfCnpjValido(digitado);
    if (!cpfCnpj) throw erroCpfInvalido();
  }
  const doLead = cpfCnpjValido(lead?.cpf);
  const final = {
    ...base,
    nome: base.nome || lead?.nome || undefined,
    telefone: base.telefone || lead?.telefone || undefined,
    email: base.email || lead?.email || undefined,
    cpfCnpj: cpfCnpj || doLead || undefined,
  };
  if (!final.cpfCnpj) delete final.cpfCnpj;
  if (exigeCpfCnpj(provedor) && !final.cpfCnpj && !final.clienteExternoId) throw erroSemCpf();
  const cpfNovoDoLead = cpfCnpj && lead && !doLead && cpfCnpj.length === 11 ? cpfCnpj : null;
  return { pagador: final, cpfNovoDoLead };
}

module.exports = { exigeCpfCnpj, cpfCnpjValido, resolverPagador, erroSemCpf, erroCpfInvalido };
