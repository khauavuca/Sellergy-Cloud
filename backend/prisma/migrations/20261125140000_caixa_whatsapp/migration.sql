-- Caixa de entrada do WhatsApp (tela /app/whatsapp): conversas por contato e
-- todas as mensagens que entram e saem pelo numero conectado do negocio.
-- Ver backend/src/conversas/.

CREATE TABLE IF NOT EXISTS "conversas" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "telefoneEnvio" TEXT NOT NULL,
    "nomeContato" TEXT,
    "leadId" TEXT,
    "botId" TEXT,
    "canal" TEXT,
    "ultimaMensagemEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaMensagemTexto" TEXT,
    "ultimaMensagemOrigem" TEXT,
    "ultimaEntradaEm" TIMESTAMP(3),
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "botPausado" BOOLEAN NOT NULL DEFAULT false,
    "botPausadoAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversas_clienteId_telefone_key" ON "conversas"("clienteId", "telefone");
CREATE INDEX IF NOT EXISTS "conversas_clienteId_ultimaMensagemEm_idx" ON "conversas"("clienteId", "ultimaMensagemEm");
CREATE INDEX IF NOT EXISTS "conversas_leadId_idx" ON "conversas"("leadId");

CREATE TABLE IF NOT EXISTS "mensagens_conversa" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEBIDA',
    "erro" TEXT,
    "idExterno" TEXT,
    "autorUsuarioId" TEXT,
    "autorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_conversa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mensagens_conversa_conversaId_criadoEm_idx" ON "mensagens_conversa"("conversaId", "criadoEm");
CREATE INDEX IF NOT EXISTS "mensagens_conversa_clienteId_criadoEm_idx" ON "mensagens_conversa"("clienteId", "criadoEm");

DO $$ BEGIN
  ALTER TABLE "mensagens_conversa" ADD CONSTRAINT "mensagens_conversa_conversaId_fkey"
    FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
