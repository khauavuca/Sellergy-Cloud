#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh.
#
# Uso:
#   scripts/restaurar-backup.sh banco ARQUIVO [--banco-teste NOME]
#   scripts/restaurar-backup.sh midia ARQUIVO
#
#   banco ARQUIVO                 SUBSTITUI o banco de produção (pede confirmação,
#                                 para backend/worker durante a restauração).
#   banco ARQUIVO --banco-teste X restaura num banco SEPARADO (X) dentro do mesmo
#                                 Postgres, sem tocar em produção. É o "teste de
#                                 restauração" mensal (ver DEPLOY.md).
#   midia ARQUIVO                 SUBSTITUI o conteúdo do volume do MinIO.
#
# Chave pra decifrar (não fica na VPS no dia a dia):
#   .age -> AGE_IDENTIDADE=/caminho/chave-backup.txt (chave PRIVADA do age)
#   .gpg -> BACKUP_SENHA_ARQUIVO=/etc/sellergy/backup.senha
# Copie a chave privada pra VPS só na hora de restaurar e apague depois
# (shred -u chave-backup.txt).
#
# Backup que está só no off-site: baixe antes com
#   rclone copy "$RCLONE_DESTINO/banco-2026-11-23_0330.dump.age" /var/backups/sellergy/
set -Eeuo pipefail
umask 077

ARQUIVO_CONFIG="${BACKUP_CONFIG:-/etc/sellergy/backup.env}"
if [ -f "$ARQUIVO_CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$ARQUIVO_CONFIG"
fi

PASTA_PROJETO="${PASTA_PROJETO:-$(cd "$(dirname "$0")/.." && pwd)}"
COMPOSE_ARQUIVO="${COMPOSE_ARQUIVO:-$PASTA_PROJETO/docker-compose.prod.yml}"
VOLUME_MIDIA="${VOLUME_MIDIA:-sellergy_cloud_prod_minio_data}"
IMAGEM_AUXILIAR="${IMAGEM_AUXILIAR:-alpine:3.22.2}"
AGE_IDENTIDADE="${AGE_IDENTIDADE:-}"
BACKUP_SENHA_ARQUIVO="${BACKUP_SENHA_ARQUIVO:-}"

uso() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
dc() { docker compose -f "$COMPOSE_ARQUIVO" "$@"; }

TIPO="${1:-}"; ARQUIVO="${2:-}"
[ -n "$TIPO" ] && [ -n "$ARQUIVO" ] || uso
[ -f "$ARQUIVO" ] || { echo "Arquivo não encontrado: $ARQUIVO" >&2; exit 1; }
shift 2
BANCO_TESTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --banco-teste) BANCO_TESTE="${2:-}"; shift 2 ;;
    *) uso ;;
  esac
done
if [ -n "$BANCO_TESTE" ] && ! [[ "$BANCO_TESTE" =~ ^[a-z_][a-z0-9_]{0,40}$ ]]; then
  echo "Nome de banco de teste inválido (use letras minúsculas, números e _)." >&2
  exit 1
fi

decifrar() {
  case "$ARQUIVO" in
    *.age)
      [ -n "$AGE_IDENTIDADE" ] && [ -r "$AGE_IDENTIDADE" ] || { echo "Defina AGE_IDENTIDADE=arquivo da chave privada do age." >&2; exit 1; }
      age -d -i "$AGE_IDENTIDADE" "$ARQUIVO" ;;
    *.gpg)
      [ -n "$BACKUP_SENHA_ARQUIVO" ] && [ -r "$BACKUP_SENHA_ARQUIVO" ] || { echo "Defina BACKUP_SENHA_ARQUIVO." >&2; exit 1; }
      gpg --batch --quiet --decrypt --pinentry-mode loopback --passphrase-file "$BACKUP_SENHA_ARQUIVO" "$ARQUIVO" ;;
    *) echo "Extensão desconhecida (esperado .age ou .gpg): $ARQUIVO" >&2; exit 1 ;;
  esac
}

confirmar() {
  echo
  echo "ATENÇÃO: $1"
  read -r -p "Digite RESTAURAR pra continuar: " resposta
  [ "$resposta" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
}

case "$TIPO" in
  banco)
    [[ "$ARQUIVO" == *banco-*.dump.* ]] || { echo "Isso não parece um backup de banco: $ARQUIVO" >&2; exit 1; }
    if [ -n "$BANCO_TESTE" ]; then
      echo "==> Restaurando em banco de TESTE: $BANCO_TESTE (produção não é tocada)"
      dc exec -T -e BANCO_TESTE="$BANCO_TESTE" postgres sh -c \
        'dropdb -U "$POSTGRES_USER" --if-exists "$BANCO_TESTE" && createdb -U "$POSTGRES_USER" "$BANCO_TESTE"'
      decifrar | dc exec -T -e BANCO_TESTE="$BANCO_TESTE" postgres sh -c \
        'pg_restore -U "$POSTGRES_USER" -d "$BANCO_TESTE" --no-owner --exit-on-error'
      echo "==> Conferência rápida (tabelas e linhas de algumas tabelas):"
      dc exec -T -e BANCO_TESTE="$BANCO_TESTE" postgres sh -c \
        'psql -U "$POSTGRES_USER" -d "$BANCO_TESTE" -c "SELECT count(*) AS tabelas FROM information_schema.tables WHERE table_schema = '"'"'public'"'"';" -c "SELECT relname AS tabela, n_live_tup AS linhas FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"'
      echo
      echo "Teste OK. Apague o banco de teste quando terminar:"
      echo "  docker compose -f $COMPOSE_ARQUIVO exec postgres sh -c 'dropdb -U \"\$POSTGRES_USER\" $BANCO_TESTE'"
    else
      confirmar "o banco de PRODUÇÃO será APAGADO e substituído por $(basename "$ARQUIVO")."
      echo "==> Parando backend e worker"
      dc stop backend worker
      echo "==> Restaurando"
      decifrar | dc exec -T postgres sh -c \
        'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error'
      echo "==> Subindo de novo (migrações pendentes rodam no serviço migrate)"
      dc up -d
    fi
    ;;
  midia)
    [[ "$ARQUIVO" == *midia-*.tar.gz.* ]] || { echo "Isso não parece um backup de mídias: $ARQUIVO" >&2; exit 1; }
    confirmar "o conteúdo do volume $VOLUME_MIDIA será APAGADO e substituído por $(basename "$ARQUIVO")."
    echo "==> Parando o MinIO"
    dc stop minio
    echo "==> Restaurando o volume"
    decifrar | docker run --rm -i --network none --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
      --security-opt no-new-privileges:true \
      -v "$VOLUME_MIDIA:/dados" "$IMAGEM_AUXILIAR" \
      sh -c 'find /dados -mindepth 1 -delete && tar -C /dados -xzf -'
    echo "==> Subindo o MinIO"
    dc up -d minio
    ;;
  *) uso ;;
esac

echo "Restauração concluída."
