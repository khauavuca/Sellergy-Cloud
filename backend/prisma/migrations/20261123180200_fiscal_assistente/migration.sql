-- AlterTable
ALTER TABLE "configuracoes_fiscal" ADD COLUMN     "certificadoTitular" TEXT,
ADD COLUMN     "certificadoValidoAte" TIMESTAMP(3),
ADD COLUMN     "emitirAutomatico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proximoNumero" INTEGER;

