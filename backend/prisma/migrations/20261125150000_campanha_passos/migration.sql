-- Tela "Nova campanha" em 4 passos: objetivo, filtro de gasto, botao e envio agendado.
ALTER TABLE "campanhas" ADD COLUMN "objetivo" TEXT;
ALTER TABLE "campanhas" ADD COLUMN "gastoMinimo" DOUBLE PRECISION;
ALTER TABLE "campanhas" ADD COLUMN "botao" TEXT;
ALTER TABLE "campanhas" ADD COLUMN "agendadoPara" TIMESTAMP(3);

CREATE INDEX "campanhas_status_agendadoPara_idx" ON "campanhas"("status", "agendadoPara");
