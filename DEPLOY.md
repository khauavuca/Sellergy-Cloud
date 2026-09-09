# Deploy — Sellergy Cloud em produção (Oracle Cloud + Vercel)

```
navegador ──HTTPS──> Vercel (front React)
    │
    └──HTTPS──> api.<domínio> ─┐
                               ├─ Caddy (TLS) ──> backend:3333 ──> postgres / redis / minio
 imagens ──> cdn.<domínio> ────┘                  worker (Baileys + filas BullMQ)
                                                  backup (pg_dump diário)
```

Tudo que não é o front roda em **uma VM** com Docker (`docker-compose.prod.yml`).
O `docker-compose.yml` continua sendo o de **desenvolvimento** (hot reload, ngrok, pgadmin).

## 1. VM na Oracle Cloud (Always Free)

- Shape `VM.Standard.A1.Flex` — **2 OCPU / 12 GB** (limite do free tier desde 06/2026).
  Ubuntu 22.04 ou 24.04 (aarch64). Boot volume 100 GB (dos 200 free).
- Região **São Paulo** (`sa-saopaulo-1`) ou Vinhedo. "Out of host capacity" é comum —
  tente em horários diferentes ou na outra região.
- **Security List** da VCN: ingress TCP **80** e **443** (e UDP 443 pra HTTP/3) de `0.0.0.0/0`.
- **Firewall do Ubuntu da OCI** bloqueia tudo além da 22 (regra de iptables da imagem).
  Depois de entrar por SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

- **Recuperação por ociosidade:** a Oracle recupera instância free se por 7 dias CPU, rede
  **e** memória ficarem abaixo de 20%. Com a stack no ar isso não acontece.

## 2. Docker na VM

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version
```

## 3. DNS

Antes do primeiro `up`, dois registros **A** apontando pro IP público da VM:

| Registro | Vai pra |
|---|---|
| `api.seudominio.com.br` | backend (API + WebSocket) |
| `cdn.seudominio.com.br` | MinIO (imagens/PDF por URL assinada) |

O Caddy só emite o certificado se o domínio resolver pro IP da VM. O domínio do front
(Vercel) é configurado lá, não aqui.

## 4. Código e variáveis

```bash
git clone <repo> sellergy && cd sellergy
cp .env.production.example .env
nano .env
```

Preencha tudo marcado `TROQUE`. Gerar segredos:

```bash
openssl rand -hex 32       # JWT_SECRET, DB_PASSWORD, MINIO_ROOT_PASSWORD
openssl rand -base64 32    # MENSAGENS_MASTER_KEY (tem que ser 32 bytes em base64)
```

`MENSAGENS_MASTER_KEY` cifra credenciais de PSP/fiscal/WhatsApp e as sessões Baileys.
**Guarde uma cópia fora da VM** — perder essa chave = perder tudo que foi cifrado.

## 5. Subir

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f backend
```

O backend roda `prisma migrate deploy` sozinho no start. O worker e o Caddy só sobem
depois do backend ficar saudável (migrações aplicadas, API no ar). O Caddy emite os
certificados no primeiro acesso a cada domínio (~10 s).

Conferir: `curl https://api.seudominio.com.br/saude` → `{"status":"ok",...}`.

Seed (categorias padrão etc.), só na primeira vez:

```bash
docker compose -f docker-compose.prod.yml exec backend node prisma/seed.js
```

## 6. Primeiro usuário admin

```bash
curl -X POST https://api.seudominio.com.br/autenticacao/registrar \
  -H "Content-Type: application/json" \
  -d '{"nome":"Seu Nome","email":"voce@seudominio.com.br","senha":"uma-senha-forte"}'
```

> Essa rota existe **só pra este bootstrap**: cria um **ADMIN** da plataforma e, a partir
> do momento em que existe um ADMIN, passa a responder 404 pra sempre. Tenants e
> colaboradores entram por convite, pelo painel — nunca por aqui.

## 7. Front na Vercel

Projeto na Vercel com **Root Directory = `frontend/`** (build `npm run build`, output
`dist`; o `vercel.json` já faz o rewrite de SPA). Env vars **na Vercel**:

| Var | Valor |
|---|---|
| `VITE_API_URL` | `https://api.seudominio.com.br` |
| `VITE_URL_PUBLICA` | `https://api.seudominio.com.br` |

No `.env` da VM, `CORS_ORIGINS` = o domínio do front na Vercel. Front e API estão em
domínios diferentes, então o cookie de sessão precisa de `COOKIE_SAMESITE=none` +
`COOKIE_SECURE=true` (já é o default do example).

## 8. Webhooks externos

| Quem | URL a cadastrar |
|---|---|
| Meta (WhatsApp Cloud) | `https://api.seudominio.com.br/webhooks/whatsapp` |
| PSP (Mercado Pago / Asaas / Pagar.me) | `https://api.seudominio.com.br/webhooks/...` (ver `backend/src/routes/webhooks.routes.js`) |

Não precisa mais de ngrok.

## 9. Backup

O serviço `backup` faz um `pg_dump` ao subir e depois a cada 24 h, no volume
`backup_data`, apagando o que passar de `BACKUP_RETENCAO_DIAS` (14).

```bash
# listar
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups
# restaurar (CUIDADO: --clean apaga e recria os objetos)
docker compose -f docker-compose.prod.yml exec backup sh -c \
  'PGPASSWORD=$DB_PASSWORD pg_restore -h postgres -U $DB_USER -d $DB_NAME --clean --if-exists /backups/<arquivo>.dump'
```

Isso protege contra erro humano e corrupção do volume. **Não protege contra a VM
sumir** — os dumps estão no mesmo disco. Copie pra fora periodicamente:

```bash
# do seu computador
scp ubuntu@IP-DA-VM:/var/lib/docker/volumes/sellergy_cloud_prod_backup_data/_data/*.dump ./backups/
```

O Object Storage da Oracle tem 20 GB no free tier — automatizar o envio pra lá com
`rclone` é o próximo passo natural.

## 10. Atualizar

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrações pendentes rodam no start do backend. O worker reinicia e reconecta os bots
Baileys sozinho (a sessão fica no banco, cifrada).

## 11. Operação

```bash
docker compose -f docker-compose.prod.yml ps                 # saúde de cada serviço
docker compose -f docker-compose.prod.yml logs -f worker     # Baileys + filas
docker compose -f docker-compose.prod.yml exec postgres psql -U sellergy -d sellergy
docker stats                                                 # memória por container
```

Console do MinIO (9001) fica só no loopback da VM — túnel SSH:

```bash
ssh -L 9001:127.0.0.1:9001 ubuntu@IP-DA-VM   # depois abra http://localhost:9001
```

## 12. Segurança (o que este compose já garante)

- Só o Caddy expõe porta (80/443). Postgres, Redis, MinIO e o backend ficam na rede
  interna do Docker.
- `trust proxy = 1` no backend está **correto** aqui: exatamente um proxy (Caddy) na
  frente. Como a 3333 não é pública, não dá pra falsificar `X-Forwarded-For` batendo
  direto no backend.
- TLS e renovação automáticos (Caddy). `.env` fora das imagens (`.dockerignore`).
  Backend roda como usuário `node`. Limite de memória e rotação de log por container.
- `FISCAL_LIVE=false` até homologar na SEFAZ.

Pendente (ver `docs/fase1-oracle-e-desempenho.md`, Fase 2): healthcheck do worker;
sharding dos workers Baileys pra passar de ~40 bots.
