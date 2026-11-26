-- Devolucao de aluguel encerrada pelo cancelamento da venda.
ALTER TABLE "devolucoes" ADD COLUMN IF NOT EXISTS "canceladaEm" TIMESTAMP(3);

-- Dados antigos: devolucao pendente de venda ja cancelada fica encerrada
-- (o cancelamento ja tinha devolvido o estoque) e nao gera mais lembrete.
UPDATE "devolucoes" d
   SET "canceladaEm" = COALESCE(v."dataCancelamento", NOW()),
       "lembreteEnviadoEm" = COALESCE(d."lembreteEnviadoEm", NOW())
  FROM "vendas" v
 WHERE v."id" = d."vendaId"
   AND v."status" = 'CANCELLED'
   AND d."devolvidoEm" IS NULL
   AND d."canceladaEm" IS NULL;
