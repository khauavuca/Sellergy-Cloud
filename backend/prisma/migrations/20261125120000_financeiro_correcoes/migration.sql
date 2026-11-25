-- Correcoes do financeiro (testes de uso, letra C).

-- 1. Chave de repeticao: clique duplo em "criar lancamento" nao duplica.
ALTER TABLE "lancamentos_financeiros" ADD COLUMN IF NOT EXISTS "chaveRepeticao" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "lancamentos_financeiros_clienteId_chaveRepeticao_key"
  ON "lancamentos_financeiros"("clienteId", "chaveRepeticao");

-- 2. Vencimento gravado a meia-noite UTC (= 21h do dia anterior em Brasilia)
--    aparecia 1 dia antes. A regra nova grava 12:00 UTC; corrige os antigos.
UPDATE "lancamentos_financeiros"
   SET "dataVencimento" = "dataVencimento" + INTERVAL '12 hours'
 WHERE "dataVencimento"::time = TIME '00:00:00';

-- 3. Vinculos com cliente/venda de OUTRO negocio (aceitos antes por falta de
--    validacao) sao desfeitos: o lancamento fica, o vinculo some.
UPDATE "lancamentos_financeiros" l
   SET "leadId" = NULL
  FROM "leads" le
 WHERE l."leadId" = le."id" AND le."clienteId" <> l."clienteId";

UPDATE "lancamentos_financeiros" l
   SET "vendaId" = NULL
  FROM "vendas" v
 WHERE l."vendaId" = v."id" AND v."clienteId" <> l."clienteId";
