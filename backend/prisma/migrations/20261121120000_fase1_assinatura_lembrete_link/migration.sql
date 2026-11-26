-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('TRIAL', 'ATIVA', 'ATRASADA', 'SUSPENSA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusFatura" AS ENUM ('ABERTA', 'PAGA', 'VENCIDA', 'CANCELADA');

-- AlterEnum
ALTER TYPE "OrigemAgendamento" ADD VALUE 'LINK_PUBLICO';

-- AlterTable
ALTER TABLE "agendamentos" ADD COLUMN     "confirmadoEm" TIMESTAMP(3),
ADD COLUMN     "confirmadoPor" TEXT,
ADD COLUMN     "lembrete24hEm" TIMESTAMP(3),
ADD COLUMN     "lembrete2hEm" TIMESTAMP(3),
ADD COLUMN     "tokenConfirmacao" TEXT;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "caixaAutomatico" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "configLembrete" JSONB,
ADD COLUMN     "proximaCobrancaEm" TIMESTAMP(3),
ADD COLUMN     "slugPublico" TEXT,
ADD COLUMN     "statusAssinatura" "StatusAssinatura" NOT NULL DEFAULT 'ATIVA',
ADD COLUMN     "trialAte" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "faturas_assinatura" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" "StatusFatura" NOT NULL DEFAULT 'ABERTA',
    "cobrancaExternaId" TEXT,
    "linkPagamento" TEXT,
    "pagaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faturas_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faturas_assinatura_status_vencimento_idx" ON "faturas_assinatura"("status", "vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "faturas_assinatura_clienteId_competencia_key" ON "faturas_assinatura"("clienteId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "agendamentos_tokenConfirmacao_key" ON "agendamentos"("tokenConfirmacao");

-- CreateIndex
CREATE INDEX "agendamentos_status_data_idx" ON "agendamentos"("status", "data");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_slugPublico_key" ON "clientes"("slugPublico");

-- AddForeignKey
ALTER TABLE "faturas_assinatura" ADD CONSTRAINT "faturas_assinatura_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

