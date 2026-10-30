#!/usr/bin/env bash
#
# reseed-deps.sh — recreate the node_modules volume from the current image.
#
# WHY THIS EXISTS (the trap that made this script necessary):
#
#   node_modules inside the containers lives in a NAMED VOLUME, which Docker
#   seeds from the image only ONCE — on the volume's first attach. The bind
#   mount (.:/app) does NOT provide node_modules; the volume shadows it.
#
#   So after you `npm install` a new package on your host:
#     - the host has it            ✓
#     - package-lock.json has it   ✓
#     - the IMAGE would have it    ✓ (after a rebuild)
#     - the RUNNING container      ✗  ← stale, still has the old volume
#
#   Symptoms: "drizzle-kit: not found", "Cannot find module 'zod'", or the
#   reverse — a native module built for darwin-arm64 crashing in linux-arm64.
#
#   The fix is NOT `npm install` inside the container (that mutates the box
#   and drifts from the image). The fix is to delete the stale volume and let
#   Docker re-seed it from a freshly built image.
#
# USAGE:
#   ./scripts/reseed-deps.sh          # rebuild + reseed, keep postgres data
#   ./scripts/reseed-deps.sh --wipe   # ALSO drop postgres data (dev reset)
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="stickynotes-ai"
NODE_MODULES_VOLUME="${PROJECT}_node_modules"
COMPOSE_PROFILES="tools"

if [ "${1:-}" = "--wipe" ]; then
  echo "⚠️  --wipe: dropping ALL volumes (postgres data will be lost)"
  docker compose --profile "$COMPOSE_PROFILES" down -v
  echo "✓ full down -v complete. Next 'up' reseeds everything."
  exit 0
fi

echo "1/4  rebuilding image (lockfile change invalidates the deps layer)…"
docker compose --profile "$COMPOSE_PROFILES" build --pull=false

echo "2/4  stopping containers…"
docker compose --profile "$COMPOSE_PROFILES" down --remove-orphans

echo "3/4  removing stale dep volume (postgres_data is KEPT)…"
docker volume rm "$NODE_MODULES_VOLUME" 2>/dev/null \
  && echo "     removed ${NODE_MODULES_VOLUME}" \
  || echo "     volume already absent — nothing to remove"

echo "4/4  starting fresh; volume reseeds from the new image…"
docker compose --profile "$COMPOSE_PROFILES" up -d

echo
echo "Verifying a couple of key packages landed in the fresh volume:"
docker compose exec -T web sh -c '
  for p in next react zod drizzle-orm postgres; do
    [ -d "node_modules/$p" ] && printf "  ✓ %s\n" "$p" || printf "  ✗ %s MISSING\n" "$p"
  done
  [ -e node_modules/.bin/drizzle-kit ] && echo "  ✓ drizzle-kit (bin)" || echo "  ✗ drizzle-kit MISSING"
  echo "  total: $(ls node_modules | wc -l | tr -d " ") packages"
'

echo
echo "Done. If postgres_data was kept, your data is intact."
