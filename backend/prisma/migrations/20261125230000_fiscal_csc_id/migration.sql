-- ID do CSC da NFC-e (vai pro cadastro da empresa no emissor da Sellergy).
ALTER TABLE "configuracoes_fiscal" ADD COLUMN IF NOT EXISTS "cscId" TEXT;
