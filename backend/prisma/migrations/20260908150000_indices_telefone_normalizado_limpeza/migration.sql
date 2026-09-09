-- Fase 1 (docs/fase1-oracle-e-desempenho.md), Lote 2 — banco.
--
-- 1) Limpeza: Bot.menuConfig (nunca usado) e os dois modelos de auditoria que
--    apontavam pra tabelas ja dropadas no pivo (mensagens_conversa/execucoes)
--    e que nenhum codigo escrevia. IF EXISTS: o banco de dev pode ja ter
--    passado por uma migration local (nao versionada) que dropou menuConfig.
-- 2) Lead.telefoneNormalizado + backfill: forma canonica do telefone (so
--    digitos, sem DDI 55) pra achar o lead de um remetente do WhatsApp por
--    igualdade indexada, em vez de carregar todos os leads do tenant.
-- 3) Indices que faltavam: Postgres nao indexa chave estrangeira sozinho, e
--    toda listagem por tenant (leads, mensagens, financeiro, estoque, agenda)
--    era Seq Scan. Os nomes seguem a convencao do Prisma (gerados com
--    `prisma migrate diff`), entao o schema.prisma e este arquivo batem.

-- AlterTable
ALTER TABLE "bots" DROP COLUMN IF EXISTS "menuConfig";

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "telefoneNormalizado" TEXT;

-- Backfill: mesma regra de backend/src/utils/telefone.js — so digitos; se
-- sobrar 12-13 digitos comecando com 55, e DDI + DDD + numero: tira o 55.
UPDATE "leads" AS l
SET "telefoneNormalizado" = CASE
  WHEN length(d.digitos) IN (12, 13) AND d.digitos LIKE '55%' THEN substr(d.digitos, 3)
  ELSE d.digitos
END
FROM (
  SELECT "id", regexp_replace("telefone", '\D', '', 'g') AS digitos
  FROM "leads"
  WHERE "telefone" IS NOT NULL
) AS d
WHERE l."id" = d."id" AND d.digitos <> '';

-- DropTable
DROP TABLE IF EXISTS "auditoria_mensagens";

-- DropTable
DROP TABLE IF EXISTS "auditoria_acoes_agente";

-- CreateIndex
CREATE INDEX "usuarios_clienteId_idx" ON "usuarios"("clienteId");

-- CreateIndex
CREATE INDEX "saldo_historico_clienteId_data_idx" ON "saldo_historico"("clienteId", "data");

-- CreateIndex
CREATE INDEX "bots_clienteId_idx" ON "bots"("clienteId");

-- CreateIndex
CREATE INDEX "bots_identificadorCanal_idx" ON "bots"("identificadorCanal");

-- CreateIndex
CREATE INDEX "bots_verifyTokenCanal_idx" ON "bots"("verifyTokenCanal");

-- CreateIndex
CREATE INDEX "leads_clienteId_etapaId_idx" ON "leads"("clienteId", "etapaId");

-- CreateIndex
CREATE INDEX "leads_clienteId_telefoneNormalizado_idx" ON "leads"("clienteId", "telefoneNormalizado");

-- CreateIndex
CREATE INDEX "lead_historico_leadId_criadoEm_idx" ON "lead_historico"("leadId", "criadoEm");

-- CreateIndex
CREATE INDEX "mensagens_leadId_criadoEm_idx" ON "mensagens"("leadId", "criadoEm");

-- CreateIndex
CREATE INDEX "agendamentos_clienteId_data_idx" ON "agendamentos"("clienteId", "data");

-- CreateIndex
CREATE INDEX "vendas_clienteId_status_data_idx" ON "vendas"("clienteId", "status", "data");

-- CreateIndex
CREATE INDEX "produtos_clienteId_visibilidade_idx" ON "produtos"("clienteId", "visibilidade");

-- CreateIndex
CREATE INDEX "variacoes_produto_produtoId_idx" ON "variacoes_produto"("produtoId");

-- CreateIndex
CREATE INDEX "campanhas_clienteId_idx" ON "campanhas"("clienteId");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_variacaoId_tipo_data_idx" ON "movimentacoes_estoque"("variacaoId", "tipo", "data");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_vendaId_idx" ON "movimentacoes_estoque"("vendaId");

-- CreateIndex
CREATE INDEX "lancamentos_financeiros_clienteId_status_dataPagamento_idx" ON "lancamentos_financeiros"("clienteId", "status", "dataPagamento");

-- CreateIndex
CREATE INDEX "lancamentos_financeiros_clienteId_tipo_status_dataVenciment_idx" ON "lancamentos_financeiros"("clienteId", "tipo", "status", "dataVencimento");

-- CreateIndex
CREATE INDEX "categorias_financeiras_clienteId_idx" ON "categorias_financeiras"("clienteId");

-- CreateIndex
CREATE INDEX "alertas_clienteId_status_idx" ON "alertas"("clienteId", "status");
