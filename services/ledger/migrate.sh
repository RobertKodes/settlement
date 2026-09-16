#!/usr/bin/env bash
# Applies services/ledger/migrations/*.sql in lexical order, once each (tracked in schema_migrations).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATABASE_URL="${DATABASE_URL:-postgres://settlement:settlement@localhost:5439/settlement}"
run_psql() { if command -v psql >/dev/null 2>&1; then psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; else docker exec -i settlement-postgres psql -U settlement -d settlement -v ON_ERROR_STOP=1 -q "$@"; fi; }
run_psql -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
for f in "$DIR"/migrations/*.sql; do
  name=$(basename "$f")
  if [ "$(run_psql -tA -c "SELECT 1 FROM schema_migrations WHERE name='$name'")" = "1" ]; then echo "skip  $name"; continue; fi
  echo "apply $name"
  run_psql < "$f"
  run_psql -c "INSERT INTO schema_migrations(name) VALUES ('$name');"
done
run_psql -tA -c "SELECT count(*) || ' tables' FROM information_schema.tables WHERE table_schema='public';"
