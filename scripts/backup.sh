#!/usr/bin/env bash
# Backup diário do Sellergy Cloud: banco (pg_dump) + mídias (volume do MinIO),
# CRIPTOGRAFADOS, com retenção local e cópia fora da VPS (rclone).
#
# Rode como o usuário de deploy (grupo docker), de preferência pelo cron:
#   30 3 * * *  /home/deploy/Sellergy-Cloud/scripts/backup.sh >> /var/backups/sellergy/backup.log 2>&1
#
# Configuração: /etc/sellergy/backup.env (FORA do repositório; chmod 600), ou
# variáveis de ambiente. Exemplo de /etc/sellergy/backup.env:
#
#   # Criptografia (escolha UMA):
#   #  a) age com CHAVE PÚBLICA (recomendado): a VPS só consegue CIFRAR. A chave
#   #     privada fica no seu PC/cofre; quem invadir a VPS não abre os backups.
#   BACKUP_AGE_DESTINATARIO=age1xxxxxxxx...
#   #  b) gpg simétrico: senha num arquivo (chmod 600) fora do repositório.
#   # BACKUP_SENHA_ARQUIVO=/etc/sellergy/backup.senha
#
#   RCLONE_DESTINO=b2:sellergy-backups/vps1   # remoto configurado com `rclone config`
#   RETENCAO_DIAS=7                           # backups locais
#   BACKUP_MIDIA=sempre                       # sempre | domingo | nunca
#   BACKUP_AVISO_URL=https://hc-ping.com/uuid # opcional (healthchecks.io grátis)
#
# Gera em $PASTA_BACKUP:
#   banco-AAAA-MM-DD_HHMM.dump.age   (pg_dump formato custom, já compactado)
#   midia-AAAA-MM-DD_HHMM.tar.gz.age (conteúdo do volume do MinIO)
# (.gpg no lugar de .age se usar gpg.) Restaure com scripts/restaurar-backup.sh.
set -Eeuo pipefail
umask 077

ARQUIVO_CONFIG="${BACKUP_CONFIG:-/etc/sellergy/backup.env}"
if [ -f "$ARQUIVO_CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$ARQUIVO_CONFIG"
fi

PASTA_PROJETO="${PASTA_PROJETO:-$(cd "$(dirname "$0")/.." && pwd)}"
COMPOSE_ARQUIVO="${COMPOSE_ARQUIVO:-$PASTA_PROJETO/docker-compose.prod.yml}"
PASTA_BACKUP="${PASTA_BACKUP:-/var/backups/sellergy}"
RETENCAO_DIAS="${RETENCAO_DIAS:-7}"
BACKUP_MIDIA="${BACKUP_MIDIA:-sempre}"
RCLONE_DESTINO="${RCLONE_DESTINO:-}"
BACKUP_AGE_DESTINATARIO="${BACKUP_AGE_DESTINATARIO:-}"
BACKUP_SENHA_ARQUIVO="${BACKUP_SENHA_ARQUIVO:-}"
BACKUP_AVISO_URL="${BACKUP_AVISO_URL:-}"
VOLUME_MIDIA="${VOLUME_MIDIA:-sellergy_cloud_prod_minio_data}"
IMAGEM_AUXILIAR="${IMAGEM_AUXILIAR:-alpine:3.22.2}"

DATA="$(date +%F_%H%M)"
log() { echo "[$(date '+%F %T')] $*"; }

avisar_falha() {
  log "ERRO: backup falhou (linha $1)."
  if [ -n "$BACKUP_AVISO_URL" ]; then curl -fsS -m 10 --retry 3 "$BACKUP_AVISO_URL/fail" >/dev/null || true; fi
}
trap 'avisar_falha $LINENO' ERR

# Uma execução por vez (cron atrasado + execução manual não se atropelam).
mkdir -p "$PASTA_BACKUP"
exec 9>"$PASTA_BACKUP/.backup.lock"
if ! flock -n 9; then
  log "Outro backup em andamento; saindo."
  exit 0
fi

# --- Criptografia -----------------------------------------------------------
if [ -n "$BACKUP_AGE_DESTINATARIO" ]; then
  command -v age >/dev/null || { log "ERRO: instale o age (apt install age)."; exit 1; }
  EXT="age"
  cifrar() { age -r "$BACKUP_AGE_DESTINATARIO"; }
elif [ -n "$BACKUP_SENHA_ARQUIVO" ]; then
  [ -r "$BACKUP_SENHA_ARQUIVO" ] || { log "ERRO: não consigo ler $BACKUP_SENHA_ARQUIVO."; exit 1; }
  EXT="gpg"
  cifrar() {
    gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
      --pinentry-mode loopback --passphrase-file "$BACKUP_SENHA_ARQUIVO" -o -
  }
else
  log "ERRO: defina BACKUP_AGE_DESTINATARIO (recomendado) ou BACKUP_SENHA_ARQUIVO."
  log "Backup sem criptografia não é feito: ele sairia da VPS com dados de clientes."
  exit 1
fi

dc() { docker compose -f "$COMPOSE_ARQUIVO" "$@"; }

# Grava em .parcial e só renomeia no fim: arquivo com nome final = completo.
gerar() {
  local destino="$1"; shift
  "$@" > "$destino.parcial"
  if [ ! -s "$destino.parcial" ]; then
    rm -f "$destino.parcial"
    log "ERRO: $destino saiu vazio."
    return 1
  fi
  mv "$destino.parcial" "$destino"
  log "OK: $(basename "$destino") ($(du -h "$destino" | cut -f1))"
}

# --- 1. Banco ---------------------------------------------------------------
log "Banco: pg_dump"
ARQ_BANCO="$PASTA_BACKUP/banco-$DATA.dump.$EXT"
dump_banco() {
  # Usuário e banco vêm do próprio container (não precisa ler o .env).
  dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6 --no-owner' | cifrar
}
gerar "$ARQ_BANCO" dump_banco

# --- 2. Mídias (MinIO) ------------------------------------------------------
fazer_midia=0
case "$BACKUP_MIDIA" in
  sempre) fazer_midia=1 ;;
  domingo) [ "$(date +%u)" = 7 ] && fazer_midia=1 ;;
  nunca) ;;
  *) log "BACKUP_MIDIA inválido ($BACKUP_MIDIA); usando 'sempre'."; fazer_midia=1 ;;
esac
if [ "$fazer_midia" = 1 ]; then
  log "Mídias: volume $VOLUME_MIDIA"
  ARQ_MIDIA="$PASTA_BACKUP/midia-$DATA.tar.gz.$EXT"
  dump_midia() {
    # Container descartável, volume montado SÓ-LEITURA e sem rede.
    docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges:true \
      -v "$VOLUME_MIDIA:/dados:ro" "$IMAGEM_AUXILIAR" \
      tar -C /dados -czf - . | cifrar
  }
  gerar "$ARQ_MIDIA" dump_midia
fi

# --- 3. Retenção local ------------------------------------------------------
log "Retenção: apagando backups locais com mais de $RETENCAO_DIAS dias"
find "$PASTA_BACKUP" -maxdepth 1 -type f \( -name 'banco-*' -o -name 'midia-*' \) \
  -mtime "+$((RETENCAO_DIAS - 1))" -print -delete
find "$PASTA_BACKUP" -maxdepth 1 -type f -name '*.parcial' -mmin +360 -delete

# --- 4. Fora da VPS ---------------------------------------------------------
if [ -n "$RCLONE_DESTINO" ]; then
  log "Off-site: rclone -> $RCLONE_DESTINO"
  # `copy` (não `sync`): nunca apaga nada no destino. A retenção lá fica por
  # conta da regra de ciclo de vida do bucket (ver DEPLOY.md).
  rclone copy "$PASTA_BACKUP" "$RCLONE_DESTINO" \
    --include 'banco-*' --include 'midia-*' --exclude '*.parcial' \
    --max-age 48h --transfers 2 --bwlimit 4M --retries 5 --low-level-retries 10
else
  log "AVISO: RCLONE_DESTINO vazio; backup ficou SÓ na VPS (se ela sumir, ele some junto)."
fi

if [ -n "$BACKUP_AVISO_URL" ]; then curl -fsS -m 10 --retry 3 "$BACKUP_AVISO_URL" >/dev/null || true; fi
log "Backup concluído."
