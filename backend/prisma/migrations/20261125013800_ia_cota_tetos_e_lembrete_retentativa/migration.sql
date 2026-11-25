-- IA: cota nova do plano Negocio (2 milhoes de tokens/mes) e excedente a
-- R$ 15 por milhao (1,5 centavo por mil tokens -> coluna vira DOUBLE).
ALTER TABLE "bots" ALTER COLUMN "iaPrecoPorMilTokensExcedenteCentavos" TYPE DOUBLE PRECISION USING "iaPrecoPorMilTokensExcedenteCentavos"::double precision;
ALTER TABLE "bots" ALTER COLUMN "iaPrecoPorMilTokensExcedenteCentavos" SET DEFAULT 1.5;
ALTER TABLE "bots" ALTER COLUMN "iaTokensIncluidosMes" SET DEFAULT 2000000;
ALTER TABLE "bots" ADD COLUMN "iaExcedenteAutorizadoTokens" INTEGER NOT NULL DEFAULT 0;

-- Bots que ainda estavam no padrao antigo (100 mil tokens / 8 centavos por
-- mil) passam pro padrao novo. Valores ajustados a mao ficam como estao.
UPDATE "bots" SET "iaTokensIncluidosMes" = 2000000 WHERE "iaTokensIncluidosMes" = 100000;
UPDATE "bots" SET "iaPrecoPorMilTokensExcedenteCentavos" = 1.5 WHERE "iaPrecoPorMilTokensExcedenteCentavos" = 8;

-- Aviso de cota esgotada (1 por mes por bot).
ALTER TABLE "consumo_ia" ADD COLUMN "cotaEsgotadaAvisadaEm" TIMESTAMP(3);

-- Teto global diario da plataforma.
CREATE TABLE "consumo_ia_diario" (
    "dia" TEXT NOT NULL,
    "tokensUsados" INTEGER NOT NULL DEFAULT 0,
    "tetoAtingidoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumo_ia_diario_pkey" PRIMARY KEY ("dia")
);

-- Lembretes: reserva + tentativas (marca enviado so depois do sucesso).
ALTER TABLE "agendamentos" ADD COLUMN "lembreteReservadoAte" TIMESTAMP(3);
ALTER TABLE "agendamentos" ADD COLUMN "lembreteTentativas" INTEGER NOT NULL DEFAULT 0;
