#!/usr/bin/env bash
# Start the API (port 5000) and the Vite dev server (port 5173) against the
# seeded disposable database, in the background. Logs go to the cache.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CACHE="${WAMPUMS_RUN_CACHE:-$HOME/.cache/wampums-run}"
SEED="$CACHE/seed.json"
[ -f "$SEED" ] || { echo "No $SEED -- run db.sh and seed.mjs first"; exit 1; }
ORG_ID="$(node -p "require('$SEED').organizationId")"
DB_URL="$(node -p "require('$SEED').database")"
mkdir -p "$CACHE/logs"

"$(dirname "$0")/stop.sh" >/dev/null

# .env carries a stale production DATABASE_URL. dotenv never overwrites a
# variable that is already set, so these win. On localhost the API resolves the
# unit from ORGANIZATION_ID rather than from organization_domains.
DATABASE_URL="$DB_URL" \
JWT_SECRET_KEY="wampums-run-local-secret" \
ORGANIZATION_ID="$ORG_ID" \
PORT=5000 NODE_ENV=development \
  nohup node api.js > "$CACHE/logs/api.log" 2>&1 &
nohup npx vite --port 5173 --strictPort > "$CACHE/logs/vite.log" 2>&1 &

timeout 60 bash -c 'until curl -sf http://127.0.0.1:5000/api/v1/organizations/get_organization_id >/dev/null; do sleep 1; done'
timeout 60 bash -c 'until curl -sf http://127.0.0.1:5173/ >/dev/null; do sleep 1; done'
echo "API  http://127.0.0.1:5000   (log: $CACHE/logs/api.log)"
echo "SPA  http://127.0.0.1:5173   (log: $CACHE/logs/vite.log)"
echo "unit $(curl -s http://127.0.0.1:5173/api/v1/organizations/get_organization_id)"
