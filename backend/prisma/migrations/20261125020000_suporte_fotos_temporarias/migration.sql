-- Fotos temporarias no chamado: apagadas ao resolver; conversa apagada 7 dias depois.
ALTER TABLE "chamados" ADD COLUMN "resolvidoEm" TIMESTAMP(3);
ALTER TABLE "chamados" ADD COLUMN "conversaApagadaEm" TIMESTAMP(3);
ALTER TABLE "chamados_mensagens" ADD COLUMN "anexoChave" TEXT;
ALTER TABLE "chamados_mensagens" ADD COLUMN "anexoTipo" TEXT;
ALTER TABLE "chamados_mensagens" ADD COLUMN "anexoNome" TEXT;
ALTER TABLE "chamados_mensagens" ADD COLUMN "anexoApagadoEm" TIMESTAMP(3);

-- Chamados ja resolvidos contam a partir de agora.
UPDATE "chamados" SET "resolvidoEm" = NOW() WHERE "status" = 'RESOLVIDO';
CREATE INDEX "chamados_status_resolvidoEm_idx" ON "chamados"("status", "resolvidoEm");
