-- Versao da sessao do usuario: vai dentro do token (sv) e e conferida a cada
-- pedido. Trocar senha, mudar o papel ou redefinir a senha de alguem soma 1 e
-- derruba as sessoes antigas na hora (ver src/seguranca/sessaoUsuario.js).
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "versaoSessao" INTEGER NOT NULL DEFAULT 0;

-- Listagem paginada de clientes (CRM): ordem por atualizacao dentro do negocio.
CREATE INDEX IF NOT EXISTS "leads_clienteId_atualizadoEm_idx" ON "leads" ("clienteId", "atualizadoEm" DESC);
