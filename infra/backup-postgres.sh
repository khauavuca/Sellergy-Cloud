#!/bin/sh
# Backup diário do Postgres (pg_dump formato custom, comprimido) com retenção.
# Roda no serviço `backup` do docker-compose.prod.yml, na imagem
# postgres:16-alpine (pg_dump na mesma versão do servidor).
#
#   - faz um dump ao subir (o primeiro backup não espera 24h);
#   - depois, um dump a cada 24h;
#   - apaga dumps mais velhos que BACKUP_RETENCAO_DIAS (padrão 14).
#
# Os dumps ficam no volume `backup_data` (/backups). Protege contra "apaguei a
# tabela errada" e contra corrupção do volume do Postgres — NÃO contra a VM
# inteira sumir (é o mesmo disco). Pra isso, copie pra fora (DEPLOY.md §9).
#
# Restaurar (CUIDADO, --clean apaga e recria):
#   PGPASSWORD=$DB_PASSWORD pg_restore -h postgres -U $DB_USER -d $DB_NAME \
#     --clean --if-exists /backups/<arquivo>.dump

set -u

DIR=/backups
RETENCAO="${BACKUP_RETENCAO_DIAS:-14}"
INTERVALO=86400

mkdir -p "$DIR"

fazer_backup() {
  ts=$(date +%Y%m%d-%H%M%S)
  arquivo="$DIR/$DB_NAME-$ts.dump"
  if PGPASSWORD="$DB_PASSWORD" pg_dump -h postgres -U "$DB_USER" -d "$DB_NAME" -Fc -Z 6 -f "$arquivo"; then
    echo "[backup] ok  $arquivo ($(du -h "$arquivo" | cut -f1))"
  else
    echo "[backup] FALHOU $ts" >&2
    rm -f "$arquivo"
  fi
  # -mtime +N = modificado há mais de N dias.
  find "$DIR" -name "*.dump" -type f -mtime +"$RETENCAO" -delete
}

echo "[backup] iniciado — retenção ${RETENCAO}d, intervalo ${INTERVALO}s"
while true; do
  fazer_backup
  sleep "$INTERVALO"
done
