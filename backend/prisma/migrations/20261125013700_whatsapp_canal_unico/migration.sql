-- Numero de WhatsApp (identificadorCanal) unico entre todos os bots: impede
-- que outro tenant configure o phoneNumberId/numero de alguem e passe a
-- receber as mensagens dele.
--
-- Indice unico comum (igual ao que o Prisma gera pra `@unique`): no Postgres
-- ele ja aceita varios NULL, entao vale "unico quando nao nulo" sem drift
-- entre o schema e o banco (um indice parcial o `migrate dev` tentaria recriar).

-- Vazio vira NULL (a rota ja grava NULL; dados antigos podem ter '').
UPDATE "bots" SET "identificadorCanal" = NULL WHERE btrim(COALESCE("identificadorCanal", '')) = '';

-- Duplicados existentes: fica com o bot mais antigo (o primeiro a configurar
-- o numero); os outros perdem o identificador e precisam reconectar.
UPDATE "bots" b SET "identificadorCanal" = NULL
WHERE b."identificadorCanal" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "bots" o
    WHERE o."identificadorCanal" = b."identificadorCanal"
      AND (o."criadoEm" < b."criadoEm" OR (o."criadoEm" = b."criadoEm" AND o."id" < b."id"))
  );

CREATE UNIQUE INDEX "bots_identificadorCanal_key" ON "bots"("identificadorCanal");
