#!/bin/sh
# Deploys the API on the VPS. Run from the repo checkout:
#   ./deploy.sh [image-tag]   (default: main; pass a commit SHA to roll back)
# Requires `docker login ghcr.io` beforehand (CI does this automatically).
set -eu

TAG="${1:-main}"
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Updating compose/Caddy config from git"
git pull --ff-only origin main

echo "==> Pulling image tag: $TAG"
export API_IMAGE_TAG="$TAG"
$COMPOSE pull api

echo "==> Restarting containers"
$COMPOSE up -d --no-build --remove-orphans

echo "==> Waiting for /api/health"
# Ask the API container directly, so the check doesn't depend on Caddy's
# domain/TLS setup.
for i in $(seq 1 30); do
  if $COMPOSE exec -T api wget -qO- http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "==> Healthy after $((i * 2))s"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "!! API did not become healthy within 60s; recent logs:" >&2
$COMPOSE logs --tail=100 api >&2
exit 1
