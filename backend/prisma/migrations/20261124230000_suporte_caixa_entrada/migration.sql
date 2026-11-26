-- Suporte em caixa de entrada: categoria, prioridade, responsavel, tempos e avaliacao.
ALTER TABLE "chamados" ADD COLUMN "categoria" TEXT NOT NULL DEFAULT 'DUVIDA';
ALTER TABLE "chamados" ADD COLUMN "prioridade" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "chamados" ADD COLUMN "responsavelId" TEXT;
ALTER TABLE "chamados" ADD COLUMN "primeiraRespostaEm" TIMESTAMP(3);
ALTER TABLE "chamados" ADD COLUMN "ultimaDoClienteEm" TIMESTAMP(3);
ALTER TABLE "chamados" ADD COLUMN "lidoSuporteEm" TIMESTAMP(3);
ALTER TABLE "chamados" ADD COLUMN "avaliacao" INTEGER;
ALTER TABLE "chamados" ADD COLUMN "avaliacaoComentario" TEXT;

-- Chamados que ja existiam: a ultima mensagem do cliente vira o ponto de partida.
UPDATE "chamados" c SET "ultimaDoClienteEm" = (
  SELECT MAX(m."criadoEm") FROM "chamados_mensagens" m WHERE m."chamadoId" = c."id" AND m."autor" = 'CLIENTE'
);
UPDATE "chamados" c SET "primeiraRespostaEm" = (
  SELECT MIN(m."criadoEm") FROM "chamados_mensagens" m WHERE m."chamadoId" = c."id" AND m."autor" = 'SUPORTE'
);

CREATE INDEX "chamados_responsavelId_idx" ON "chamados"("responsavelId");
