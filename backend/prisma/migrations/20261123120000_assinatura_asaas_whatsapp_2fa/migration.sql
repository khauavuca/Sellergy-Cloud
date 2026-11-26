-- CreateEnum
CREATE TYPE "CicloAssinatura" AS ENUM ('MENSAL', 'ANUAL');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "asaasAssinaturaId" TEXT,
ADD COLUMN     "asaasCustomerId" TEXT,
ADD COLUMN     "canceladoEm" TIMESTAMP(3),
ADD COLUMN     "cicloAssinatura" "CicloAssinatura" NOT NULL DEFAULT 'MENSAL',
ADD COLUMN     "cpfCnpj" TEXT,
ADD COLUMN     "formaPagamento" TEXT,
ADD COLUMN     "motivoCancelamento" TEXT;

-- AlterTable
ALTER TABLE "faturas_assinatura" ADD COLUMN     "avisosRegua" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "formaPagamento" TEXT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "totpAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSegredoCifrado" TEXT;

-- CreateTable
CREATE TABLE "eventos_webhook_assinatura" (
    "id" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_webhook_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optout_whatsapp" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optout_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquetes_whatsapp" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "mensagem" JSONB NOT NULL,
    "tipo" TEXT NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "respondidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquetes_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "optout_whatsapp_clienteId_telefone_key" ON "optout_whatsapp"("clienteId", "telefone");

-- CreateIndex
CREATE INDEX "enquetes_whatsapp_criadoEm_idx" ON "enquetes_whatsapp"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_asaasCustomerId_key" ON "clientes"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_asaasAssinaturaId_key" ON "clientes"("asaasAssinaturaId");

-- CreateIndex
CREATE INDEX "faturas_assinatura_cobrancaExternaId_idx" ON "faturas_assinatura"("cobrancaExternaId");

