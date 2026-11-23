# Deploy — Sellergy Cloud (produção)

Divisão pensada pra começar barato:

| Onde | O quê | Endereço |
|---|---|---|
| **Hostinger (hospedagem web)** | front (arquivos estáticos do Vite) | `https://sellergycloud.com` |
| **VPS Linux 1 GB** (Docker) | API, worker, Postgres, Redis, MinIO, Caddy (HTTPS) | `https://api.sellergycloud.com` · `https://midia.sellergycloud.com` |
| **Cloudflare Free** (recomendado) | DNS, proxy, WAF, rate limit | na frente de tudo |
| **Backblaze B2** (ou outro S3 barato) | cópia dos backups criptografados | fora da VPS |

> O `docker-compose.yml` continua sendo o de **desenvolvimento** (hot reload, ngrok,
> pgadmin). Produção usa o `docker-compose.prod.yml`.

## Custo mensal estimado

| Item | Custo aproximado |
|---|---|
| VPS 1 GB RAM / 1 vCPU / 20-25 GB disco | R$ 25 a 35 |
| Hospedagem compartilhada Hostinger (plano anual) | R$ 10 a 15 |
| Domínio `.com` (≈ R$ 70/ano) | ≈ R$ 6 |
| Cloudflare Free (DNS, proxy, WAF, 1 regra de rate limit) | R$ 0 |
| Let's Encrypt (certificados) | R$ 0 |
| Backblaze B2 (10 GB grátis; depois US$ 6/TB) | R$ 0 a 2 |
| healthchecks.io (aviso se o backup falhar) | R$ 0 |
| **Total** | **≈ R$ 45 a 60/mês** |

Valores de referência (nov/2026), variam com câmbio e promoção. Quando tiver
uso real (vários WhatsApps conectados, catálogos todo dia), suba a VPS pra 2 GB
(+R$ 20-30): é o mesmo compose, não muda nada.

## Por que cabe em 1 GB

Medido com a stack parada: Postgres ~50 MB, Redis ~10 MB, MinIO ~110 MB,
backend ~65 MB, worker ~50 MB. O que foi feito pra caber:

- **Front fora da VPS** (o Vite dev-server sozinho comia ~600 MB em dev).
- **Imagem do backend multi-stage** (`backend/Dockerfile.prod`): sem compilador nem
  devDependencies; roda `node` direto, sem `npm`/`nodemon` residentes.
- **Migrações num container que roda e sai** (`migrate`).
- **Postgres, Redis e MinIO com configuração de pouca memória** (ver comentários no compose).
- **Limite de memória por container** e **logs com rotação** (10 MB × 3 por serviço).
- **PDF do catálogo**: um Chromium por vez, com flags de pouca memória.
- **Swap de 2 GB** na VPS (o script de preparo cria) pra absorver picos.

---

## Passo a passo

### 1. DNS

Com Cloudflare (recomendado, ver [Segurança › Cloudflare](#cloudflare-grátis-recomendado)):
crie a conta, adicione `sellergycloud.com` e troque os **nameservers** no painel da
Hostinger pelos que o Cloudflare indicar. Depois, no DNS do Cloudflare:

| Tipo | Nome | Aponta pra | Proxy |
|---|---|---|---|
| A | `@` e `www` | IP da hospedagem Hostinger | laranja |
| A | `api` | IP da VPS | **cinza no 1º deploy**, laranja depois |
| A | `midia` | IP da VPS | **cinza no 1º deploy**, laranja depois |

Sem Cloudflare: só crie os registros A `api` e `midia` no painel da Hostinger.
Espere o DNS propagar (`ping api.sellergycloud.com` responde o IP da VPS) antes
do passo 4, senão o Caddy não tira o certificado HTTPS.

### 2. Chave SSH (no seu PC, uma vez)

```bash
ssh-keygen -t ed25519 -C "voce@pc"        # use uma senha (passphrase) na chave
# copie o conteúdo de ~/.ssh/id_ed25519.pub
```

Cadastre a chave pública no painel da VPS ao criar a máquina (ou em
`/root/.ssh/authorized_keys`).

### 3. Preparar e endurecer a VPS (uma vez; pode repetir sem medo)

```bash
ssh root@IP_DA_VPS
git clone https://github.com/khauavuca/Sellergy-Cloud.git /root/Sellergy-Cloud
PORTA_SSH=22 bash /root/Sellergy-Cloud/scripts/preparar-vps.sh
```

Cria o usuário `deploy`, desliga login por senha e de root, liga firewall,
fail2ban, atualizações automáticas de segurança, swap e Docker (detalhes em
[Segurança](#segurança)). **Antes de fechar a sessão de root**, teste em outro
terminal: `ssh deploy@IP_DA_VPS`. Daqui pra frente, use só o `deploy`:

```bash
ssh deploy@IP_DA_VPS
git clone https://github.com/khauavuca/Sellergy-Cloud.git
cd Sellergy-Cloud
```

### 4. Variáveis e subir

```bash
cp .env.production.example .env
chmod 600 .env
nano .env                          # troque TODOS os TROQUE_AQUI
#   openssl rand -hex 32           -> JWT_SECRET, DB_PASSWORD, REDIS_PASSWORD,
#                                     MINIO_ROOT_PASSWORD (= MINIO_SECRET_KEY),
#                                     ASAAS_PLATAFORMA_WEBHOOK_TOKEN
#   openssl rand -base64 32        -> MENSAGENS_MASTER_KEY
docker compose -f docker-compose.prod.yml up -d --build
```

O backend **se recusa a subir** se algum segredo estiver vazio, curto, repetitivo
ou com valor de exemplo (o log diz qual). O primeiro build demora (~5-10 min numa
VPS pequena; o swap segura a memória). Depois:

```bash
docker compose -f docker-compose.prod.yml ps          # tudo "healthy", migrate "Exited (0)"
docker compose -f docker-compose.prod.yml logs -f backend
curl https://api.sellergycloud.com/saude              # {"status":"ok",...}
docker stats --no-stream                              # memória de cada container
```

Usuário admin inicial (`admin@sellergy.cloud`, senha padrão do `backend/prisma/seed.js`).
Rode **só na primeira vez**, troque a senha logo depois de entrar e ative o
código em 2 etapas (com `ADMIN_2FA_OBRIGATORIO=true` o painel exige):

```bash
docker compose -f docker-compose.prod.yml run --rm migrate node prisma/seed.js
```

### 5. Front na Hostinger

No seu PC, na pasta `frontend/`:

```bash
npm ci
npm run build        # usa VITE_API_URL=https://api.sellergycloud.com
```

Suba **o conteúdo** da pasta `frontend/dist/` (não a pasta em si) pra `public_html/`
pelo Gerenciador de Arquivos do hPanel ou por FTP**S**. O `.htaccess` já vem junto
(HTTPS forçado, headers de segurança, CSP, cache e rotas do React). Ative o SSL do
domínio no hPanel. Confira no navegador (F12 › Console) que nada foi bloqueado
pela CSP.

### 6. Backup (configurar no mesmo dia do deploy)

**No seu PC**, gere o par de chaves do backup ([age](https://age-encryption.org),
no Windows `winget install FiloSottile.age`):

```bash
age-keygen -o chave-backup.txt
# imprime "Public key: age1...": é ela que vai pra VPS.
```

Guarde `chave-backup.txt` (a chave **privada**) no gerenciador de senhas e num
pendrive. **Ela não vai pra VPS**: quem invadir o servidor consegue gerar backup,
mas não abrir os antigos. Perdeu a chave privada = perdeu os backups.

**No Backblaze B2**: crie um bucket privado (ex. `sellergy-backups`), uma regra de
ciclo de vida "manter só a última versão por 30 dias" e uma *Application Key*
**restrita a esse bucket, sem permissão de apagar** (`listFiles`, `readFiles`,
`writeFiles`). Assim nem um invasor com a chave consegue apagar os backups
antigos (proteção contra ransomware).

**Na VPS** (como `deploy`):

```bash
rclone config                      # novo remoto "b2" com a Application Key acima
sudo mkdir -p /etc/sellergy
sudo tee /etc/sellergy/backup.env >/dev/null <<'EOF'
BACKUP_AGE_DESTINATARIO=age1COLE_A_CHAVE_PUBLICA
RCLONE_DESTINO=b2:sellergy-backups/vps1
RETENCAO_DIAS=7
BACKUP_MIDIA=sempre
# BACKUP_AVISO_URL=https://hc-ping.com/SEU-UUID
EOF
sudo chown deploy:deploy /etc/sellergy/backup.env && sudo chmod 600 /etc/sellergy/backup.env
bash scripts/backup.sh             # primeiro backup na mão
crontab -e                         # e agende:
```

```cron
30 3 * * * /home/deploy/Sellergy-Cloud/scripts/backup.sh >> /var/backups/sellergy/backup.log 2>&1
```

Gera todo dia, em `/var/backups/sellergy/`, `banco-DATA.dump.age` (pg_dump
compactado) e `midia-DATA.tar.gz.age` (fotos do MinIO), apaga os locais com mais de
7 dias e copia pro B2. Sem chave configurada o script **se recusa** a rodar
(backup sem criptografia não sai da VPS). Se as mídias crescerem muito, use
`BACKUP_MIDIA=domingo`. Alternativa sem age: `BACKUP_SENHA_ARQUIVO=/etc/sellergy/backup.senha`
(gpg simétrico; a senha fica na VPS, então protege menos).

#### Teste de restauração (todo mês — backup que nunca foi restaurado não é backup)

```bash
# 1. copie a chave privada pra VPS só agora
scp chave-backup.txt deploy@IP_DA_VPS:/tmp/chave-backup.txt
# 2. restaure o último backup num banco SEPARADO (produção não é tocada)
AGE_IDENTIDADE=/tmp/chave-backup.txt \
  scripts/restaurar-backup.sh banco /var/backups/sellergy/banco-AAAA-MM-DD_0330.dump.age \
  --banco-teste restauracao_teste
#    -> mostra quantas tabelas e linhas voltaram; compare com produção
# 3. teste também uma cópia vinda do B2 (prova que o off-site funciona)
rclone copy b2:sellergy-backups/vps1/banco-AAAA-MM-DD_0330.dump.age /tmp/
# 4. limpe
docker compose -f docker-compose.prod.yml exec postgres sh -c 'dropdb -U "$POSTGRES_USER" restauracao_teste'
shred -u /tmp/chave-backup.txt
```

Restauração **de verdade** (desastre): `scripts/restaurar-backup.sh banco ARQUIVO`
(pede para digitar RESTAURAR, para backend/worker, restaura e sobe de novo) e
`scripts/restaurar-backup.sh midia ARQUIVO`. Numa VPS nova: passos 3 e 4,
`rclone copy` dos arquivos e os dois comandos acima.

### 7. Atualizar (nova versão)

```bash
cd ~/Sellergy-Cloud && git pull
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f          # apaga imagens antigas (libera disco)
```

As migrações pendentes rodam sozinhas (serviço `migrate`). Se mudou o front,
refaça o passo 5. **Imagens base** (Node, Postgres, Redis, MinIO, Caddy) têm tag
fixa: a cada 1-2 meses, troque pra última versão de correção (ex. `16.11` →
`16.12`) no `docker-compose.prod.yml` / `backend/Dockerfile.prod` e rode o comando acima.

---

## Variáveis novas (`.env`)

| Variável | Valores | Pra quê |
|---|---|---|
| `REDIS_PASSWORD` | `openssl rand -hex 32` | Senha do Redis. O compose monta `REDIS_URL=redis://:SENHA@redis:6379`. |
| `ASAAS_PLATAFORMA_API_KEY` | chave `$aact_...` | Conta **do Sellergy** no Asaas (cobrança das assinaturas). Vazio = cobrança desligada. |
| `ASAAS_PLATAFORMA_AMBIENTE` | `sandbox` \| `producao` | Padrão `sandbox` (cobrança de teste). |
| `ASAAS_PLATAFORMA_WEBHOOK_TOKEN` | `openssl rand -hex 32` | Token que o Asaas manda no webhook (cadastre o mesmo valor no painel do Asaas). Obrigatório quando a chave da API existe; sem ele a rota recusa tudo. |
| `PLATAFORMA_CLIENTE_ID` | id do Cliente | Negócio do próprio Sellergy cujo WhatsApp conectado avisa os clientes (cobrança, plano). Vazio = só aviso dentro do sistema. |
| `BAILEYS_ENVIO_REAL` | `0` \| `1` | `1` = WhatsApp por QR Code envia de verdade; `0` = só registra no log. |
| `ADMIN_2FA_OBRIGATORIO` | `true` \| `false` | `true` = admin só entra no painel com o código de 2 etapas. **Tem que ser `true` por extenso** (`1` não liga). |

Todas estão no `.env.production.example`. O backend barra valores fora dessas
listas no boot de produção (um `BAILEYS_ENVIO_REAL=true`, por exemplo, deixaria o
envio desligado sem ninguém perceber).

---

## Segurança

Defesa em camadas: cada uma segura o que a anterior deixar passar.

### 1. Borda: Cloudflare (grátis, recomendado)

<a id="cloudflare-grátis-recomendado"></a>

Com o proxy **laranja** ligado, o IP da VPS some do DNS e todo tráfego passa pelo
Cloudflare, que absorve DDoS e filtra ataque comum antes de chegar na VPS.

1. **SSL/TLS › Overview: Full (strict)**. O Cloudflare só fala HTTPS com a VPS e
   confere o certificado do Caddy (e o da Hostinger). Nunca use "Flexible".
2. **SSL/TLS › Edge Certificates**: TLS mínimo 1.2; "Always Use HTTPS" ligado.
3. **Proxy laranja em `api` e `midia` só depois do 1º certificado** emitido pelo
   Caddy (subir com cinza, conferir `curl https://api...`, então ligar laranja).
   As renovações seguintes passam pelo Cloudflare normalmente.
4. **Security › WAF › Managed rules**: deixe o "Cloudflare Free Managed Ruleset" ligado.
5. **Security › WAF › Custom rules** (5 grátis). Sugestões:
   - *Bloquear sondagem*: `(http.request.uri.path contains "/wp-" or http.request.uri.path contains ".php" or http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git")` → **Block**.
   - *Desafio no login vindo de fora do Brasil*: `(http.host eq "api.sellergycloud.com" and http.request.uri.path contains "/autenticacao/" and ip.geoip.country ne "BR")` → **Managed Challenge**.
   - **Não** bloqueie/desafie os webhooks (`/webhooks/...`): Asaas e Meta chamam
     de fora do Brasil e não resolvem desafio.
6. **Security › WAF › Rate limiting rules** (1 grátis): `http.request.uri.path contains "/autenticacao/login"`
   → 5 requisições / 10 s por IP → Block por 10 s. (O backend ainda tem o
   `express-rate-limit` próprio.)
7. **Bot Fight Mode**: só no domínio raiz; na API ele pode barrar webhooks.
8. **Aceitar só o Cloudflare na VPS** (depois que tudo estiver laranja): no
   `caddy/Caddyfile`, descomente `trusted_proxies`/`client_ip_headers` (o
   backend passa a ver o IP real do visitante no rate limit), o snippet
   `so_cloudflare` e os `import so_cloudflare`, e o `header_up X-Forwarded-For`
   da API. Quem tentar o IP da VPS direto leva a conexão cortada. (Isso fica no
   Caddy e não no ufw porque as portas publicadas pelo Docker passam por fora
   das regras do ufw.)

### 2. Hostinger (front)

`frontend/public/.htaccess`: HTTPS forçado; HSTS; `X-Content-Type-Options`;
`X-Frame-Options DENY` + CSP `frame-ancestors 'none'` (anti-clickjacking);
`Referrer-Policy`; `Permissions-Policy` (câmera, microfone, localização
desligados); **Content-Security-Policy** que só libera scripts do próprio site
(o script do tema saiu do HTML pra `public/tema-inicial.js` pra não precisar de
`unsafe-inline`), Google Fonts, a API (`https`/`wss`) e as imagens do `midia`;
bloqueio de arquivos ocultos/backup (`.env`, `.git`, `.sql`...); PHP desligado
(se alguém subir um `.php`, ele não roda); cache longo só nos assets com hash.
Use FTPS/SFTP e senha forte + 2FA no hPanel.

### 3. VPS (sistema operacional) — `scripts/preparar-vps.sh`

- **SSH só por chave**: sem senha, sem root, só o usuário `deploy`, 3 tentativas
  por conexão, porta configurável (`PORTA_SSH`). O arquivo de configuração tem
  prefixo `00-` pra ganhar de configurações do provedor (ex. cloud-init).
- **Firewall ufw**: entrada negada por padrão; só SSH (com limite de conexões),
  80 e 443.
- **fail2ban**: 5 erros de SSH em 10 min = 1 h banido; reincidente = 1 semana.
- **Atualizações automáticas de segurança** (unattended-upgrades) todo dia.
  `REINICIO_AUTO=1` reinicia às 04:30 quando o kernel pedir (os containers voltam
  sozinhos); com 0, rode `sudo reboot` quando aparecer `*** System restart required ***`.
- **sysctl**: SYN cookies (SYN flood), anti-spoofing (rp_filter), sem ICMP
  redirect nem source route, `kptr_restrict`/`dmesg_restrict`, sem core dump de setuid.
- **Docker**: rotação de logs pra todo container, `no-new-privileges` por padrão,
  `live-restore`. Só o `deploy` entra no grupo `docker` (que equivale a root).
- **Swap 2 GB** com `swappiness=10`.

### 4. Containers — `docker-compose.prod.yml`

| Camada | Onde | Efeito |
|---|---|---|
| Sem portas de banco | Postgres, Redis, MinIO | Nada publicado; só a rede interna. As **únicas** portas abertas da stack são 80/443 do Caddy. |
| Rede `interna` sem internet | Postgres, Redis, MinIO | `internal: true`: mesmo comprometido, não baixa malware nem manda dados pra fora. Backend, worker e Caddy têm também a rede `internet`. |
| Usuário sem privilégio | backend, worker, migrate | Rodam como `node` (uid 1000); código com dono root, só-leitura. |
| `read_only` + tmpfs `/tmp` (noexec) | backend, worker, Caddy (e front opcional) | Malware não consegue se gravar no container; nada no `/tmp` executa. |
| `no-new-privileges` | todos | Nada ganha privilégio via setuid. |
| `cap_drop: ALL` | todos | Sem capabilities do Linux. Devolvidas só: Postgres `CHOWN, FOWNER, DAC_READ_SEARCH, SETUID, SETGID` (o entrypoint acerta a pasta de dados e troca pro usuário postgres); Redis `CHOWN, SETUID, SETGID` (idem); Caddy `NET_BIND_SERVICE` (portas 80/443). Backend, worker e MinIO: nenhuma. |
| `pids_limit` | todos | Segura fork-bomb e minerador que dispara processos. |
| Redis com senha | Redis | `requirepass` + `REDIS_URL` com senha. |
| Limite de memória | todos | Um vazamento não derruba os outros (orçamento de 1 GB + swap). |
| Healthchecks | todos | `docker compose ps` mostra quem está doente. |
| Tags fixas | imagens | Nada de `:latest`; atualização é decisão consciente. |

O MinIO usa hoje a credencial root no backend. Melhoria recomendada: um usuário
só do bucket:

```bash
docker compose -f docker-compose.prod.yml exec minio sh -c '
  mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
  mc admin user add local sellergy-app SENHA_HEX_32 &&
  mc admin policy attach local readwrite --user sellergy-app'
# e no .env: MINIO_ACCESS_KEY=sellergy-app / MINIO_SECRET_KEY=SENHA_HEX_32
```

### 5. Caddy (HTTPS) — `caddy/Caddyfile`

HTTPS automático (Let's Encrypt) e HTTP/3; só os hosts `API_DOMINIO` e
`MIDIA_DOMINIO` são atendidos (IP direto ou outro nome não tem certificado);
HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`;
header `Server` removido; timeouts contra slowloris; corpo máximo de 8 MB na API.
No `midia`: só GET/HEAD, e CSP `sandbox` — mesmo que um HTML/SVG disfarçado
chegasse ao bucket, o navegador abriria sem script. Log de acesso em JSON
(`docker compose logs caddy`).

### 6. Aplicação (backend)

- `backend/src/seguranca/validarAmbiente.js`: em produção o processo **não sobe**
  com segredo ausente/curto/de exemplo (JWT, chave mestra, MinIO, Asaas, senhas
  do Postgres e Redis), CORS aberto ou interruptor com valor inválido.
- `backend/src/seguranca/uploadSeguro.js`: upload validado pelos **bytes** do
  arquivo (não pelo nome nem pelo tipo que o navegador diz): só JPEG/PNG/WebP de
  verdade nas imagens, texto puro no CSV, XML sem DOCTYPE/ENTITY na NF-e;
  executáveis, scripts, ZIP, PDF, HTML e SVG barrados; imagem com código
  escondido nos metadados barrada; limite de tamanho e de pixels; nome aleatório.
- Já existiam: `helmet`, CORS restrito a `CORS_ORIGINS`, cookie `Secure` +
  `SameSite=lax` + CSRF, rate limit, credenciais de integração cifradas
  (AES-256-GCM por tenant), XML de NF-e sem XXE.
- Envio real de WhatsApp, IA, emissão fiscal e cobrança **desligados** até você
  ligar no `.env`.

### 7. Backups

Diários, **criptografados com chave pública** (a VPS não consegue abrir os
próprios backups), 7 dias locais, cópia no B2 com chave **sem permissão de
apagar**, teste de restauração mensal. Ver passo 6.

### Checklist pós-deploy

- [ ] `ssh root@IP` e `ssh -o PubkeyAuthentication=no deploy@IP` são **recusados**.
- [ ] `sudo ufw status` mostra só SSH, 80, 443.
- [ ] `docker compose -f docker-compose.prod.yml ps` tudo `healthy`.
- [ ] `curl -I https://api.sellergycloud.com/saude` tem `strict-transport-security` e não tem `server:`.
- [ ] [securityheaders.com](https://securityheaders.com) nota A em `sellergycloud.com` e na API.
- [ ] [ssllabs.com/ssltest](https://www.ssllabs.com/ssltest/) nota A.
- [ ] Primeiro backup gerado e visível no B2; teste de restauração feito.
- [ ] Senha do admin trocada e 2FA ativo.

## Alternativas

- **Front na própria VPS**: `--profile frontend` no compose, renomeie
  `caddy/sites/app.caddy.exemplo` pra `app.caddy` e preencha `APP_DOMINIO`
  (custa ~30 MB a mais). A CSP do `app.caddy` é a mesma do `.htaccess`.
- **Front na Vercel**: Root Directory = `frontend/`, env `VITE_API_URL`; ajuste
  `CORS_ORIGINS` e replique os headers do `.htaccess` no `vercel.json`.
