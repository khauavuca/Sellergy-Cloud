-- WhatsApp oficial com o app do proprio cliente: confirmacao do webhook e numero conferido na Meta.
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "webhookConfirmadoEm" TIMESTAMP(3);
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "oficialNumeroExibicao" TEXT;
