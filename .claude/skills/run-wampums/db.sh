#!/usr/bin/env bash
# Build a disposable database with the full schema and every migration, the
# way the deploy applies them. Never point this at a database you care about:
# it is dropped first.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DB="${WAMPUMS_RUN_DB:-wampums_run}"
URL="postgresql:///$DB?host=/var/run/postgresql"

psql -q -c "DROP DATABASE IF EXISTS $DB" postgres
psql -q -c "CREATE DATABASE $DB" postgres
# The dump starts with a SET only newer servers know; that one error is harmless.
psql -q -d "$DB" -f attached_assets/Full_Database_schema.sql 2>&1 | grep -v transaction_timeout | grep ERROR || true
psql -q -d "$DB" -f attached_assets/permissions_list.sql
DATABASE_URL="$URL" node scripts/run-base-migrations.js 2>&1 | grep -E "^Applied|failed"
echo "database ready: $URL"
