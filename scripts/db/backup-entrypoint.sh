#!/bin/sh
# Entrypoint of the db-backup service: one backup now (so a broken setup
# shows up at deploy time), then nightly at 01:00 UTC (03:00/04:00 Kyiv).
set -eu

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  apk add --no-cache rclone >/dev/null
fi

until pg_isready -h db -U coinsave -d coinsave >/dev/null 2>&1; do
  sleep 2
done
/bin/sh /scripts/backup.sh

echo "0 1 * * * /bin/sh /scripts/backup.sh >> /proc/1/fd/1 2>&1" | crontab -
exec crond -f -l 8
