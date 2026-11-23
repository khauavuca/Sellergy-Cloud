-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "especialistaId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "comissoes_vendaId_tipo_key" ON "comissoes"("vendaId", "tipo");

