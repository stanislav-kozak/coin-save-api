#!/bin/sh
# One-time move of the data from Neon into the db container. Run on the VPS
# from the repo checkout while the API still points at Neon:
#   ./scripts/db/import-from-neon.sh '<Neon connection string>'
# Refuses to overwrite a database that already has users (add --force).
set -eu
SRC="${1:?usage: $0 '<Neon connection string>' [--force]}"
COMPOSE="docker compose -f docker-compose.prod.yml"
count() { $COMPOSE exec -T db psql "$1" -tAc "SELECT count(*) FROM \"$2\"" 2>/dev/null || echo "-"; }
LOCAL="postgresql://coinsave@localhost/coinsave"

existing=$(count "$LOCAL" User)
if [ "$existing" != "-" ] && [ "$existing" != "0" ] && [ "${2:-}" != "--force" ]; then
  echo "The VPS database already has $existing users; refusing (pass --force to overwrite)." >&2
  exit 1
fi

DUMP="/tmp/neon-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo "==> Dumping Neon"
$COMPOSE exec -T db pg_dump "$SRC" -Fc --no-owner --no-acl > "$DUMP"
echo "==> Restoring into the VPS database"
$COMPOSE exec -T db pg_restore -U coinsave -d coinsave \
  --clean --if-exists --no-owner --no-acl < "$DUMP"

echo "==> Row counts (Neon -> VPS)"
for table in User Space Wallet Category Expense RecurringTransaction; do
  echo "  $table: $(count "$SRC" "$table") -> $(count "$LOCAL" "$table")"
done
echo "Dump kept at $DUMP. If the counts match, point DATABASE_URL at the VPS database."
