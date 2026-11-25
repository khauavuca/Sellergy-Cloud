-- Primeiro uso: contas que ja existem ganham o basico que a conta nova passa a
-- receber no cadastro (src/onboarding/padroes.js). Idempotente: so cria o que
-- falta, entao rodar de novo nao duplica nada.

-- 1) Categorias financeiras padrao.
INSERT INTO "categorias_financeiras" ("id", "clienteId", "nome", "tipo", "uso")
SELECT gen_random_uuid()::text, c."id", 'Serviços', 'RECEITA', 'SERVICO'
FROM "clientes" c
WHERE NOT EXISTS (
  SELECT 1 FROM "categorias_financeiras" f WHERE f."clienteId" = c."id" AND f."tipo" = 'RECEITA' AND f."uso" = 'SERVICO'
);

INSERT INTO "categorias_financeiras" ("id", "clienteId", "nome", "tipo", "uso")
SELECT gen_random_uuid()::text, c."id", 'Produtos', 'RECEITA', 'PRODUTO'
FROM "clientes" c
WHERE NOT EXISTS (
  SELECT 1 FROM "categorias_financeiras" f WHERE f."clienteId" = c."id" AND f."tipo" = 'RECEITA' AND f."uso" = 'PRODUTO'
);

INSERT INTO "categorias_financeiras" ("id", "clienteId", "nome", "tipo", "uso", "subTipo")
SELECT gen_random_uuid()::text, c."id", 'Despesas fixas', 'DESPESA', 'DESPESA', 'FIXA'
FROM "clientes" c
WHERE NOT EXISTS (
  SELECT 1 FROM "categorias_financeiras" f WHERE f."clienteId" = c."id" AND f."tipo" = 'DESPESA' AND f."uso" = 'DESPESA'
);

-- 2) Etapas padrao do funil (catalogo: novo, em-contato, fechado-ganho), so
--    pra conta que ainda nao tem nenhuma etapa ligada.
INSERT INTO "lead_etapas" ("id", "clienteId", "nome", "ordem", "cor", "slug", "atualizadoEm")
SELECT gen_random_uuid()::text, c."id", e.nome, e.ordem, e.cor, e.slug, CURRENT_TIMESTAMP
FROM "clientes" c
CROSS JOIN (VALUES
  ('novo', 'Novo', 1, '#3B82F6'),
  ('em-contato', 'Em contato', 2, '#06B6D4'),
  ('fechado-ganho', 'Fechado - Ganho', 6, '#22C55E')
) AS e(slug, nome, ordem, cor)
WHERE NOT EXISTS (SELECT 1 FROM "lead_etapas" x WHERE x."clienteId" = c."id");

-- 3) Segmento de servico (SERVICO/HIBRIDO) sem nenhum profissional: o dono
--    vira o profissional que atende (ligado ao login dele).
INSERT INTO "especialistas" ("id", "clienteId", "usuarioId", "nome", "ativo", "atualizadoEm")
SELECT gen_random_uuid()::text, c."id", u."id", u."nome", true, CURRENT_TIMESTAMP
FROM "clientes" c
JOIN LATERAL (
  SELECT d."id", d."nome" FROM "usuarios" d
  WHERE d."clienteId" = c."id" AND d."perfil" = 'CLIENT'
  ORDER BY d."criadoEm" ASC LIMIT 1
) u ON true
WHERE c."segmento" IN ('SERVICO', 'HIBRIDO')
  AND NOT EXISTS (SELECT 1 FROM "especialistas" s WHERE s."clienteId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "especialistas" s2 WHERE s2."usuarioId" = u."id");

-- 4) Acento no nome da etapa do catalogo ja ligada (so o nome padrao antigo).
UPDATE "lead_etapas" SET "nome" = 'Em negociação' WHERE "slug" = 'em-negociacao' AND "nome" = 'Em negociacao';
