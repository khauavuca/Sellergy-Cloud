-- Trava contra nota duplicada: no maximo UM documento fiscal "vivo" por venda
-- e tipo (NFC-e / NFS-e). Indice unico PARCIAL (Prisma 5 nao descreve indice
-- parcial no schema.prisma; ver o comentario no model DocumentoFiscal):
--   - documentos em ERRO ou CANCELADA ficam de fora, para poder emitir de novo
--     depois de uma rejeicao ou de um cancelamento;
--   - nota avulsa (vendaId nulo) fica de fora.
-- Escrita a mao (nao gerada por `prisma migrate dev`).

-- 1) Duplicatas que ainda nao sairam do sistema (PENDENTE/PROCESSANDO) viram
--    ERRO, mantendo a mais antiga de cada venda/tipo. Se ja houver uma EMITIDA,
--    e ela que fica.
WITH ordenados AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "vendaId", "tipo"
           ORDER BY CASE "status" WHEN 'EMITIDA' THEN 0 WHEN 'PROCESSANDO' THEN 1 ELSE 2 END, "criadoEm" ASC
         ) AS posicao,
         "status"
    FROM "documentos_fiscais"
   WHERE "vendaId" IS NOT NULL
     AND "status" IN ('PENDENTE', 'PROCESSANDO', 'EMITIDA')
)
UPDATE "documentos_fiscais" d
   SET "status" = 'ERRO',
       "mensagemErro" = 'Documento duplicado desta venda (fechado na migração da trava única).',
       "atualizadoEm" = CURRENT_TIMESTAMP
  FROM ordenados o
 WHERE d."id" = o."id"
   AND o.posicao > 1
   AND o."status" IN ('PENDENTE', 'PROCESSANDO');

-- 2) Se ainda sobrar duas EMITIDAS da mesma venda/tipo (nota realmente
--    duplicada na SEFAZ), o CREATE INDEX abaixo falha de proposito: cancele a
--    duplicada no emissor antes. Para achar:
--    SELECT "vendaId", "tipo", COUNT(*) FROM "documentos_fiscais"
--     WHERE "vendaId" IS NOT NULL AND "status" = 'EMITIDA'
--     GROUP BY 1, 2 HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX "documentos_fiscais_vendaId_tipo_ativo_key"
  ON "documentos_fiscais" ("vendaId", "tipo")
  WHERE "vendaId" IS NOT NULL AND "status" IN ('PENDENTE', 'PROCESSANDO', 'EMITIDA');
