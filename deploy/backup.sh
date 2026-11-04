#!/bin/bash
# Резервная копия базы saq-bol раз в сутки (после BACKUP_HOUR по времени Казахстана).
# Старые копии старше KEEP_DAYS дней удаляются.
# Сделать копию прямо сейчас:  docker compose exec backup bash /backup.sh now
set -u
KEEP_DAYS=${KEEP_DAYS:-14}
HOUR=${BACKUP_HOUR:-3}
DIR=/backups
mkdir -p "$DIR"

dump() {
  local file="$1"
  if mongodump --uri="$MONGO_URI" --db=saq-bol --gzip --archive="$file.tmp" --quiet; then
    mv "$file.tmp" "$file"
    echo "$(date '+%F %T') копия готова: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "$(date '+%F %T') ОШИБКА: копия не создана" >&2
    return 1
  fi
}

if [ "${1:-}" = "now" ]; then
  dump "$DIR/saq-bol-$(date +%F-%H%M).archive.gz"
  exit $?
fi

while true; do
  file="$DIR/saq-bol-$(date +%F).archive.gz"
  if [ ! -f "$file" ] && [ "$(date +%-H)" -ge "$HOUR" ]; then
    dump "$file"
    find "$DIR" -name 'saq-bol-*.archive.gz' -mtime +"$KEEP_DAYS" -delete
  fi
  sleep 600
done
