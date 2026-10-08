#!/bin/sh
# Deploys one service on the VPS. Run from this repo's checkout:
#   ./deploy.sh api [image-tag]   backend  (CI of coin-save-api)
#   ./deploy.sh web [image-tag]   frontend (CI of coin-save-app)
# image-tag defaults to main; pass an older commit SHA to roll back.
# Only the named service is restarted, so a backend deploy never touches the
# frontend and vice versa. Requires `docker login ghcr.io` beforehand (CI
# does this automatically).
set -eu

SERVICE="${1:-}"
TAG="${2:-main}"
COMPOSE="docker compose -f docker-compose.prod.yml"

case "$SERVICE" in
  api)
    export API_IMAGE_TAG="$TAG"
    HEALTH_URL="http://localhost:3000/api/health"
    ;;
  web)
    export WEB_IMAGE_TAG="$TAG"
    HEALTH_URL="http://localhost:3000/"
    ;;
  *)
    echo "usage: $0 <api|web> [image-tag]" >&2
    exit 2
    ;;
esac

# Both repos deploy to this VPS; never let two deploys run at the same time.
exec 9>/tmp/coinsave-deploy.lock
echo "==> Waiting for deploy lock"
flock -w 600 9

echo "==> Updating compose/Caddy config from git"
git pull --ff-only origin main

echo "==> Pulling $SERVICE image tag: $TAG"
$COMPOSE pull "$SERVICE"

if [ "$SERVICE" = api ]; then
  # The database (and its backups) must be up before the API migrates and
  # starts; a no-op when they're already running unchanged.
  echo "==> Ensuring the database is up"
  $COMPOSE up -d --no-build db db-backup
  for i in $(seq 1 30); do
    if $COMPOSE exec -T db pg_isready -U coinsave -d coinsave >/dev/null 2>&1; then
      break
    fi
    if [ "$i" = 30 ]; then
      echo "!! database did not become ready" >&2
      exit 1
    fi
    sleep 2
  done
fi

echo "==> Restarting $SERVICE (and Caddy if needed)"
# --no-deps: never recreate the other app as a side effect (e.g. a frontend
# deploy must not move the API off a pinned rollback tag).
$COMPOSE up -d --no-build --no-deps --remove-orphans "$SERVICE" caddy

# caddy/ is bind-mounted, so compose does not notice when Caddyfile changes;
# reload it explicitly (a no-op when nothing changed).
$COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null

echo "==> Waiting for $SERVICE to become healthy"
# Ask the container directly, so the check doesn't depend on Caddy/TLS.
for i in $(seq 1 30); do
  if $COMPOSE exec -T "$SERVICE" wget -qO- "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> $SERVICE healthy after $((i * 2))s"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "!! $SERVICE did not become healthy within 60s; recent logs:" >&2
$COMPOSE logs --tail=100 "$SERVICE" >&2
exit 1
