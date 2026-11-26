-- Midia nas conversas do WhatsApp (foto, video, audio, documento, figurinha...).
ALTER TABLE "mensagens_conversa" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'TEXTO';
ALTER TABLE "mensagens_conversa" ADD COLUMN "midiaChave" TEXT;
ALTER TABLE "mensagens_conversa" ADD COLUMN "midiaMime" TEXT;
ALTER TABLE "mensagens_conversa" ADD COLUMN "midiaNome" TEXT;
ALTER TABLE "mensagens_conversa" ADD COLUMN "midiaTamanho" INTEGER;
ALTER TABLE "mensagens_conversa" ADD COLUMN "midiaSegundos" INTEGER;
ALTER TABLE "mensagens_conversa" ADD COLUMN "extra" JSONB;
ALTER TABLE "mensagens_conversa" ADD COLUMN "respondeAId" TEXT;
