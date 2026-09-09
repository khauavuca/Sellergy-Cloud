# Fase 1 — Migração pra Oracle Cloud + desempenho do backend

> Análise feita em 08/09/2026 sobre o commit `f631d30`. Cobre backend, Postgres, Redis e MinIO.
> Frontend vai pra Vercel e ngrok sai (domínio próprio) — os dois ficam fora da VM.

## Status (08/09/2026)

| Lote | Situação |
|---|---|
| **1 — Infra** | ✅ feito. Compose prod novo, Caddy, backup, `.env.production.example`, Dockerfile multi-stage (build x86 validado), ARM no Prisma, DEPLOY.md |
| **2 — Banco** | ✅ feito. Migration `20260908150000_indices_telefone_normalizado_limpeza`: 22 índices, `Lead.telefoneNormalizado` + backfill, drop de `menuConfig` e dos 2 models órfãos |
| **3 — Caminho quente** | ✅ feito. A2, A4, A5, B1, B2, B3, B4, B6 + `/registrar` vira bootstrap (fecha sozinho após o 1º ADMIN) |
| **4 — Fase 2** | pendente (C1 sharding, C2 crons → worker, B5 paginação, C4 base64 → MinIO, C6 healthcheck worker) |

Decisões que mudaram em relação ao plano original:
- **`mensagensHoje` fica** — o front usa em 5 telas como KPI. Em vez de dropar, passou a funcionar: incrementa junto com `totalMensagens` (Meta e Baileys) e zera no cron das 00:01.
- **R2 descartado** — MinIO fica na VM (§3).
- **PDF do catálogo**: sem fila BullMQ; a serialização (1 Chromium por vez) é um encadeamento de promises em `catalogoPdf.js`, e o reuso por versão (metadado S3) evita renderizar na maior parte das vezes.

Bugs achados e corrigidos de passagem (não estavam na lista):
- `acoesPermitidas` não entrava no `select` do bot (worker e webhook da Meta) → `ferramentasDoBot(undefined)` → **a IA nunca recebia ferramenta nenhuma**, em nenhum canal.
- O HTML do PDF do catálogo usava a URL canônica do bucket **privado** nas `<img>` → Chromium levava 403 → fotos quebradas. Agora assina cada imagem antes de renderizar.
- `desconectar` não cancelava uma reconexão já agendada — o timer religava o bot depois do usuário mandar desconectar.
- `aplicarCredencialEmCabecalhos` (credenciais.js) não tinha nenhum chamador e tratava tipos que não existem no enum — removida.

---

## 1. Mapa: o que vai pra Oracle, o que sai

Alvo: **Oracle Cloud Always Free**, região São Paulo/Vinhedo, `VM.Standard.A1.Flex`
**2 OCPU ARM / 12 GB RAM / 200 GB disco** (limite novo desde 15/06/2026 — era 4/24).

| Serviço | `docker-compose.yml` (dev) | `docker-compose.prod.yml` hoje | **Oracle** | Por quê |
|---|---|---|---|---|
| `postgres` | ✓ | ✓ | **✓** | dados transacionais |
| `redis` | ✓ | ✓ | **✓** | BullMQ (campanhas, comandos Baileys) + cache + pub/sub worker→backend |
| `minio` | ✓ | ✓ | **✓** | fica na VM (R2 cobra acima de 10 GB); atrás do Caddy em `cdn.` — ver §3 |
| `backend` | ✓ | ✓ | **✓** | API + Socket.io + crons |
| `worker` | ✓ | ✓ | **✓** | BullMQ + **todas** as conexões Baileys |
| `caddy` | — | — | **✓ NOVO** | TLS automático (Let's Encrypt) na frente de `api.` e `cdn.` |
| `frontend` | ✓ | ✓ ([prod.yml:129](../docker-compose.prod.yml:129)) | **✗ sai** | Vercel |
| `ngrok` | ✓ | — | **✗ sai** | domínio próprio |
| `pgadmin` | ✓ | — | **✗ sai** | dev only |

### 1.1 O que muda no `docker-compose.prod.yml`

| Mudança | Motivo |
|---|---|
| Remover serviço `frontend` | Vercel |
| Adicionar `caddy` (80/443 → `backend:3333` e `minio:9000`) | hoje o compose expõe tudo **sem TLS** |
| `TZ=America/Sao_Paulo` em `backend` e `worker` | **bug real** — ver A3 |
| `mem_limit` no `worker` (ex. 3g) e `backend` (ex. 1g) | sem isso, OOM do Chromium+Baileys leva o host pro swap em vez de matar só o container (que o `restart: unless-stopped` religa) |
| `logging: { driver: json-file, max-size: 20m, max-file: 5 }` em todos | sem rotação, o log do worker (1 linha por mensagem) enche os 200 GB com o tempo |
| `healthcheck` em `backend` (`/saude`) | hoje só postgres/redis/minio têm; backend morto não é detectado |
| `command:` do postgres com `shared_buffers=2GB effective_cache_size=6GB work_mem=32MB` | imagem alpine sobe com `shared_buffers=128MB` — numa VM de 12 GB é desperdício |
| Serviço `backup` (pg_dump diário em volume próprio + retenção 14d) | **hoje não existe backup nenhum** do volume do Postgres |
| Criar `.env.production.example` | [DEPLOY.md](../DEPLOY.md) manda copiar um arquivo que não existe no repo |

### 1.2 Variáveis que mudam de significado

- `CORS_ORIGINS` → domínio da Vercel (ex. `https://app.sellergy.com.br`)
- `VITE_API_URL` / `VITE_URL_PUBLICA` → **saem do `.env` do servidor**, vão pras env vars da Vercel
- `MINIO_PUBLIC_ENDPOINT` → `https://cdn.sellergy.com.br` (Caddy → minio)
- `NGROK_*`, `PGADMIN_*` → somem

### 1.3 Lixo pra remover do repo

- `package-lock.json` na **raiz** — órfão, não existe `package.json` na raiz
- `Bot.menuConfig` no schema — já tinha sido decidido remover
- Models `AuditoriaMensagem` ([schema:983](../backend/prisma/schema.prisma:983)) e `AuditoriaAcaoAgente` ([schema:999](../backend/prisma/schema.prisma:999)) — referenciam `mensagens_conversa` e `execucoes`, tabelas **dropadas** na migration `20260619042400_pivo_remove_ia`. Nenhum código escreve neles (grep confirma). Tabelas vazias ocupando schema.
- ~~`Bot.mensagensHoje` — contador morto~~ → o front usa; virou contador de verdade (ver Status).
- ~~`credenciais.js` → `aplicarCredencialEmCabecalhos`~~ → removida (sem chamador).

---

## 2. Achados de desempenho — por prioridade

Critério: **A** = quebra ou degrada com dados reais (corrigir antes de subir).
**B** = ganho grande, esforço baixo. **C** = arquitetura, fase 2+.

### A1 — Índices ausentes (o maior ganho por minuto de trabalho)

Postgres **não cria índice em chave estrangeira automaticamente** (MySQL cria; Postgres não).
O schema declara `@@index` em ~metade dos models; a outra metade — incluindo os mais
consultados — não tem nenhum. Hoje toda listagem por tenant é **Seq Scan**.

| Tabela | Índice faltando | Quem sofre |
|---|---|---|
| `mensagens` ([schema:360](../backend/prisma/schema.prisma:360)) | `(leadId, criadoEm)` | abrir qualquer conversa varre a tabela inteira |
| `leads` ([schema:312](../backend/prisma/schema.prisma:312)) | `(clienteId)`, `(clienteId, etapaId)` | kanban, `reabrirLeadPorTelefone` (A2), relatórios |
| `bots` ([schema:177](../backend/prisma/schema.prisma:177)) | `(identificadorCanal)`, `(verifyTokenCanal)`, `(clienteId)` | **webhook da Meta faz `findFirst` por `identificadorCanal` a cada mensagem** ([webhooksWhatsapp.routes.js:63](../backend/src/routes/webhooksWhatsapp.routes.js:63)) |
| `lancamentos_financeiros` ([schema:811](../backend/prisma/schema.prisma:811)) | `(clienteId, status, dataPagamento)`, `(clienteId, tipo, status, dataVencimento)` | todo KPI financeiro (`somarLancamentosPagos`, saldo em risco) |
| `movimentacoes_estoque` ([schema:730](../backend/prisma/schema.prisma:730)) | `(variacaoId, tipo, data)`, `(vendaId)` | CMV e top-produtos ([RelatoriosController.js:95](../backend/src/controllers/RelatoriosController.js:95), [:129](../backend/src/controllers/RelatoriosController.js:129)) fazem join triplo sem índice |
| `agendamentos` ([schema:371](../backend/prisma/schema.prisma:371)) | `(clienteId, data)` | tem `(especialistaId, data)` mas a agenda do dia/mês filtra por `clienteId + data` |
| `vendas` | `(clienteId, status, data)` | relatórios de vendas por período |
| `produtos` | `(clienteId, visibilidade)` | catálogo, PDF |
| `variacoes_produto` | `(produtoId)` | todo `include: { variacoes }` |
| `lead_historico` | `(leadId, criadoEm)` | histórico do lead |
| `usuarios` | `(clienteId)` | listagem de equipe |
| `alertas` | `(clienteId, status)` | sino de alertas |
| `categorias_financeiras`, `campanhas`, `saldo_historico` | `(clienteId)` | listagens |

**Fix:** 1 migration, ~20 `CREATE INDEX CONCURRENTLY`. Esforço: 30 min. Zero mudança de código.

### A2 — `reabrirLeadPorTelefone` carrega **todos os leads do tenant** a cada mensagem

[whatsappInbound.js:30](../backend/src/services/whatsappInbound.js:30) — roda em **toda** mensagem recebida
(Meta e Baileys). Faz `prisma.lead.findMany({ where: { clienteId, telefone: { not: null } } })`
([:34](../backend/src/services/whatsappInbound.js:34)) e filtra em JS com `endsWith`. Tenant com 5 mil
leads × 200 mensagens/dia = **1 milhão de linhas trafegadas por dia** pra achar 1.

O motivo é legítimo (lead guarda DDD+número, remetente vem com 55 na frente, e o campo pode ter
máscara) — mas resolve-se no banco:

**Fix:** coluna `Lead.telefoneNormalizado` (só dígitos, sem DDI) + índice `(clienteId, telefoneNormalizado)`,
preenchida no create/update do lead e num backfill. A busca vira
`WHERE clienteId = ? AND telefoneNormalizado IN (últimos11, últimos10)` — 1 linha, índice. Esforço: 1h.

### A3 — Container roda em UTC, código assume horário local = Brasília

13 chamadas `setHours()` em 7 arquivos operam na hora **local do processo**. Nenhum compose nem
Dockerfile define `TZ`, então dentro do container é UTC. Consequências hoje:

- [cronCaixaDiario.js:24](../backend/src/jobs/cronCaixaDiario.js:24) — `setHours(0, 1)` → o caixa
  automático **rotaciona às 21:01 de Brasília**, não à meia-noite.
- [RelatoriosController.js:19](../backend/src/controllers/RelatoriosController.js:19) — período "hoje"
  começa às 21h do dia anterior BRT.
- `agenda.routes.js:145`, `agendaSlots.js:143`, `FinanceiroController.js:154` — mesma classe.

(`cronDevolucoes` e `cronRelatorioMensal` tratam BRT explicitamente — só o caixa e os controllers ficaram pra trás.)

**Fix:** `TZ=America/Sao_Paulo` no `environment` de `backend` e `worker`. 2 linhas. Corrige os 13 pontos de uma vez.

### A4 — Baileys: tempestade no boot + reconexão sem backoff

- [gerenciadorConexao.js:215](../backend/src/services/baileys/gerenciadorConexao.js:215) `reconectarBotsPareados`
  dispara `iniciarPareamento` pra **todos** os bots num `for` sem `await` nem espaçamento. 100 bots =
  100 handshakes WhatsApp simultâneos do mesmo IP a cada deploy.
- [gerenciadorConexao.js:196](../backend/src/services/baileys/gerenciadorConexao.js:196) queda transitória →
  `setTimeout(3000)` fixo, **sem backoff, sem teto**. Se o WhatsApp instabilizar, 100 bots martelam
  reconexão a cada 3s pra sempre — do mesmo IP de datacenter. É o padrão que leva a ban.

**Fix:** boot com concorrência 3 e 1,5s entre lotes; reconexão com backoff exponencial + jitter
(3s → 6 → 12 → … → teto 5 min) e após N falhas marcar `ERROR` e parar. Esforço: 1h.

### A5 — Chromium roda dentro do processo que segura as conexões WhatsApp

[enviarCatalogo.js:83](../backend/src/services/iaFerramentas/enviarCatalogo.js:83) chama `renderizarPdf`
inline, e como é ferramenta de IA, roda **no worker**. Cada PDF sobe um Chromium
([catalogoPdf.js:151](../backend/src/services/catalogoPdf.js:151)) de ~500 MB, sem fila nem limite de
concorrência. 5 clientes pedindo catálogo ao mesmo tempo = 2,5 GB de pico no processo que segura
todas as conexões Baileys. OOM ali derruba o WhatsApp de **todos** os tenants.

**Fix (o esperto):** a chave já é fixa — `catalogos/${clienteId}/catalogo.pdf`. Guardar `Produto.atualizadoEm`
máximo do tenant como metadata do objeto; se o PDF no bucket é mais novo que a última alteração de
produto, **reusa sem renderizar**. Só renderiza quando o catálogo mudou. Quando renderizar, fila
BullMQ própria (`catalogo-pdf`, `concurrency: 1`) pra serializar o Chromium. Esforço: 2h.

### A6 — Ops: sem limite de memória, sem rotação de log, sem backup, sem healthcheck

Todos no compose — ver tabela §1.1. Nenhum é código, todos são obrigatórios antes de expor.

---

### B1 — `requerModuloLiberado` bate no banco em **toda** requisição

[permissoes.middleware.js:48](../backend/src/middlewares/permissoes.middleware.js:48) → `prisma.cliente.findUnique`
([:57](../backend/src/middlewares/permissoes.middleware.js:57)) em cada request de cada módulo. `requerPermissao`
([:108](../backend/src/middlewares/permissoes.middleware.js:108)) faz outro `findUnique` pra VENDEDOR. Isso é
+1–2 round-trips ao Postgres por request, pra dado que muda uma vez por mês.

**Fix:** `utils/cache.js` já existe e já é usado em relatórios. Cachear `{ modulosLiberados, status }`
por `clienteId` com TTL 60s e invalidar (`invalidarPrefixo`) quando o admin edita o cliente. Esforço: 45 min.

### B2 — Credencial decifrada + gravação a cada mensagem de IA

[credenciais.js:64](../backend/src/credenciais.js:64) `carregarCredencialPlataforma` roda **por mensagem**
([iaRouter.js:144](../backend/src/services/iaRouter.js:144)): `findFirst` + HKDF + AES-GCM + um `update`
de `ultimoUsoEm` ([:79](../backend/src/credenciais.js:79)). É uma chave só, da plataforma. Mesmo padrão em
`carregarCredencialDecifrada` ([:29](../backend/src/credenciais.js:29)) no webhook da Meta.

**Fix:** cache in-process da credencial decifrada (TTL 5 min, invalidado ao salvar) + `ultimoUsoEm`
gravado no máximo 1×/min por credencial. Esforço: 45 min.

### B3 — Config do bot congela no momento do pareamento

[gerenciadorConexao.js:126](../backend/src/services/baileys/gerenciadorConexao.js:126) carrega o `bot`
(`iaAtiva`, `iaPromptSistema`, `acoesPermitidas`…) **uma vez** e o handler de `messages.upsert`
captura esse objeto no closure. O tenant desliga a IA ou muda o prompt → **não tem efeito até
reiniciar o worker**. Achado de correção, não de desempenho, mas está no caminho quente.

**Fix:** reler o bot em `tratarMensagemRecebida` com cache de 30s. Esforço: 30 min.

### B4 — `cacheUrlsAssinadas` cresce sem limite

[minio.js:117](../backend/src/storage/minio.js:117) — `Map` em memória, entradas de 24h, **nunca evicta**.
Cada `imagemUrl` distinta já assinada fica lá pra sempre. Vazamento lento, mas no backend que fica
semanas no ar, vira GBs. E `transformarUrlsAssinadas` ([:174](../backend/src/storage/minio.js:174)) roda em
**toda** resposta JSON ([index.js:122](../backend/src/index.js:122)) com `await` sequencial por campo.

**Fix:** LRU com teto (5 mil entradas) ou varredura periódica das expiradas. Esforço: 20 min.

### B5 — `/crm/leads` devolve **todos** os leads, com 4 níveis de include

[crm.routes.js:229](../backend/src/routes/crm.routes.js:229) — sem `take`, `include` até
`variacao → produto → categoria`. 5 mil leads = payload de vários MB + join quádruplo por request.
Só 8 dos 45 arquivos de rota/controller têm paginação.

**Fix:** `take: 100` + cursor; front precisa acompanhar. Esforço: 1–2h (mais front). Pode ficar pra fase 2.

### B6 — Campanha: 2 mil upserts numa transação + enfileiramento 1 a 1

[campanhas.routes.js:386](../backend/src/routes/campanhas.routes.js:386) — `$transaction([...N upserts])`
segura uma conexão do pool (que são **5** na VM de 2 vCPU) por todo o lote; depois
([:400](../backend/src/routes/campanhas.routes.js:400)) `await enfileirar` um por um.

**Fix:** `createMany({ skipDuplicates: true })` + `Queue.addBulk`. Esforço: 30 min.

### B7 — Dockerfile: `npm install`, toolchain na imagem final, root

[Dockerfile:19](../backend/Dockerfile:19) `npm install` (não `npm ci` — build não reproduzível);
[Dockerfile:10](../backend/Dockerfile:10) instala `python3 make g++ linux-headers` e eles **ficam** na
imagem final; processo roda como root (é por isso que o Chromium precisa de `--no-sandbox`).
`binaryTargets` do Prisma não lista o alvo ARM explicitamente (o `native` resolve, mas deixar
explícito evita surpresa se alguém buildar com `buildx` de um x86).

**Fix:** multi-stage (`deps` com toolchain → `runtime` só com `chromium openssl`), `npm ci`,
`USER node`, `linux-musl-arm64-openssl-3.0.x` nos `binaryTargets`. Esforço: 45 min.

---

### C1 — Sharding dos workers Baileys (o teto de ~40 bots)

[gerenciadorConexao.js:37](../backend/src/services/baileys/gerenciadorConexao.js:37) — `Map` local no
**único** worker. Não escala pra fora. Desenho proposto:

- env `BAILEYS_SHARD_INDEX` / `BAILEYS_SHARD_COUNT`; o worker só assume bots com `hash(botId) % COUNT === INDEX`
- `reconectarBotsPareados` filtra pelo shard
- fila `baileys-comando` vira `baileys-comando:{shard}` e `enfileirarComandoBaileys` calcula o shard
- campanhas Baileys (`campanhaService` usa `obterSocket`) roteiam pro shard dono do bot
- compose: `worker-0`, `worker-1`… (mesma imagem, env diferente)

Fase 2. É o que destrava 100+ clientes.

### C2 — Crons rodam dentro do backend

[index.js:248](../backend/src/index.js:248)–[:267](../backend/src/index.js:267) — três crons no processo
da API. Já usam advisory lock, então 1 réplica é seguro. Mover pro worker quando o backend ganhar
réplica. Fase 2.

### C3 — Single-instance por design (ok por agora)

`express-rate-limit` com `MemoryStore`, Socket.io sem adapter Redis. Ambos quebram com 2 backends.
Não é problema hoje; anotar pra quando escalar a API.

### C4 — `Usuario.foto` e `Cliente.brandLogo` como base64 no banco

Toda leitura de usuário/cliente carrega a imagem junto. Mover pro MinIO como `imagemUrl`. Fase 2.

### C5 — Dinheiro em `Float`

`valor`, `preco`, `mensalidade`… são `Float`. Erro de arredondamento em soma de centavos.
`Decimal(12,2)` é migration grande (touca ~15 models). Fase 2+, mas registrar.

### C6 — Worker sem healthcheck

Não expõe HTTP. Se o event loop travar, nada reinicia. Heartbeat em chave Redis (`SET worker:alive EX 30`)
+ `healthcheck` no compose lendo a chave. Fase 2.

---

## 3. MinIO fica na VM

Decisão tomada: **MinIO continua**, sem R2 (cobra acima de 10 GB). Fica atrás do Caddy em
`cdn.<domínio>`; a API (9000) só é alcançada pelo proxy e o console (9001) fica preso no loopback
da VM (acesso por túnel SSH). Os 200 GB de disco do free tier e os 10 TB/mês de saída cobrem
com folga. O volume `minio_data` **não** entra no backup do Postgres — se quiser cobertura, é
um `mc mirror`/`rclone` pra fora, à parte (fase 2).

---

## 4. Plano de execução proposto

| Lote | Conteúdo | Toca em | Esforço |
|---|---|---|---|
| **1 — Infra** | compose prod novo (−frontend, +caddy, +TZ, +mem_limit, +logging, +healthcheck, +pg tuning, +backup), `.env.production.example`, Dockerfile multi-stage + ARM, lixo do repo (§1.3) | só infra, zero lógica | ~3h |
| **2 — Banco** | migration de índices (A1), `telefoneNormalizado` + backfill (A2), drop dos models órfãos + `menuConfig` | schema + 1 service | ~1,5h |
| **3 — Caminho quente** | backoff/stagger Baileys (A4), PDF cache + fila (A5), cache módulos (B1), cache credencial (B2), refresh do bot (B3), LRU URLs (B4), campanha `createMany`/`addBulk` (B6) | worker + middlewares + 2 services | ~5h |
| **4 — Fase 2** | sharding Baileys (C1), crons → worker (C2), paginação leads (B5), base64 → MinIO (C4), healthcheck worker (C6), backup do `minio_data` pra fora | arquitetura | depois de validar em prod |

Lotes 1 e 2 sobem o sistema na Oracle **sem mudar comportamento**. Lote 3 é onde o app fica
mais leve. Lote 4 é o que permite passar de ~40 pra 100+ bots.

### Estimativa de capacidade após os lotes 1–3

| Recurso | Ocioso | 30 bots ativos | Pico (PDF + campanha) |
|---|---|---|---|
| RAM | ~1 GB | ~3,5 GB | ~5 GB |
| CPU (2 OCPU) | <5% | 20–40% | 80% em rajada |

Confortável na VM free. O limite de ~40 bots é do worker único (C1), não da máquina.
