#!/bin/sh
# Runs inside the db-backup container (nightly via cron, and once at start).
# Dumps the database to /backups (7 newest kept) and, when BACKUP_S3_BUCKET is
# set, copies the dump off-site with rclone (copies older than 30 days pruned).
set -eu

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
FILE="/backups/coinsave-$STAMP.dump"

pg_dump -h db -U coinsave -d coinsave -Fc --no-owner --no-acl -f "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "backup: wrote $FILE ($(du -h "$FILE" | cut -f1))"

ls -1t /backups/coinsave-*.dump | tail -n +8 | xargs -r rm -f

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  rclone copy "$FILE" "offsite:$BACKUP_S3_BUCKET/"
  rclone delete --min-age 30d "offsite:$BACKUP_S3_BUCKET/"
  echo "backup: copied to offsite:$BACKUP_S3_BUCKET"
else
  echo "backup: WARNING: no off-site copy (BACKUP_S3_BUCKET not set)"
fi
