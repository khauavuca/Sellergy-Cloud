// Dados da empresa que aparecem nos Termos de uso e na Politica de privacidade.
// Vem das variaveis de ambiente do build (na Hostinger: Variaveis de ambiente
// do app). Enquanto alguma faltar, a pagina mostra o aviso entre colchetes,
// pra ninguem esquecer de preencher antes de divulgar.

const env = import.meta.env;

function valor(chave, aviso) {
  const v = String(env[chave] || '').trim();
  return v || `[${aviso}]`;
}

export const VERSAO_TERMOS = '2026-11-24'; // igual a backend/src/legal/versao.js
export const DATA_TERMOS = '24 de novembro de 2026';

export const EMPRESA = {
  marca: 'Sellergy Cloud',
  site: 'sellergycloud.com',
  razaoSocial: valor('VITE_EMPRESA_RAZAO_SOCIAL', 'razão social a preencher'),
  cnpj: valor('VITE_EMPRESA_CNPJ', 'CNPJ a preencher'),
  endereco: valor('VITE_EMPRESA_ENDERECO', 'endereço a preencher'),
  emailContato: valor('VITE_EMPRESA_EMAIL', 'e-mail de contato a preencher'),
  // Encarregado de dados (DPO), art. 41 da LGPD.
  encarregado: valor('VITE_EMPRESA_ENCARREGADO', 'nome do encarregado a preencher'),
  emailPrivacidade: valor('VITE_EMPRESA_EMAIL_PRIVACIDADE', 'e-mail de privacidade a preencher'),
  foro: valor('VITE_EMPRESA_FORO', 'cidade/UF do foro a preencher'),
};
