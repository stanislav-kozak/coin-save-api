#!/bin/sh
# Restores the database from a dump in the db-backups volume. Run on the VPS
# from the repo checkout:
#   ./scripts/db/restore.sh                       # list available dumps
#   ./scripts/db/restore.sh coinsave-<stamp>.dump # restore that one
# Stops the API while restoring and starts it again afterwards.
set -eu
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ $# -eq 0 ]; then
  $COMPOSE exec -T db-backup ls -1t /backups
  exit 0
fi

$COMPOSE stop api
$COMPOSE exec -T db-backup pg_restore -h db -U coinsave -d coinsave \
  --clean --if-exists --no-owner --no-acl "/backups/$1"
$COMPOSE start api
echo "restored $1"
