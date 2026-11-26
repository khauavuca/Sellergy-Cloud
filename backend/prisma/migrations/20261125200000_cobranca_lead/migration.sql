-- Cobranca ligada ao cliente final (cadastro em Clientes).
ALTER TABLE "cobrancas" ADD COLUMN "leadId" TEXT;
CREATE INDEX "cobrancas_clienteId_leadId_idx" ON "cobrancas"("clienteId", "leadId");
