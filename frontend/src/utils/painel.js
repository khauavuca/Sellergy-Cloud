// Painel admin num endereco proprio (VITE_HOST_PAINEL, ex.: crm.sellergycloud.com).
// Nos outros enderecos (sellergycloud.com) as telas /admin nem existem.
// Sem a variavel (dev em localhost) o admin abre em qualquer lugar.
const HOST_PAINEL = String(import.meta.env.VITE_HOST_PAINEL || '').trim().toLowerCase();
export const NO_PAINEL = Boolean(HOST_PAINEL) && window.location.hostname.toLowerCase() === HOST_PAINEL;
export const ADMIN_NESTE_SITE = !HOST_PAINEL || NO_PAINEL;

// Endereco do site do cliente pros links publicos (/agendar, /loja...).
// No painel o link nao pode sair com crm.: usa VITE_URL_SITE (.env.painel).
export const URL_SITE = String(import.meta.env.VITE_URL_SITE || window.location.origin).replace(/\/$/, '');
