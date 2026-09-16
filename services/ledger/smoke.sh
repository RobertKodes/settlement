#!/usr/bin/env bash
# Posts one balanced ledger transaction, replays it (idempotent), and proves entries are immutable.
set -euo pipefail
DATABASE_URL="${DATABASE_URL:-postgres://settlement:settlement@localhost:5439/settlement}"
q() { if command -v psql >/dev/null 2>&1; then psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; else docker exec -i settlement-postgres psql -U settlement -d settlement -v ON_ERROR_STOP=1 -tA -c "$1"; fi; }
q "INSERT INTO asset (symbol, chain_id, address, decimals, kind) VALUES ('USDC', 1337, NULL, 6, 'stablecoin') ON CONFLICT DO NOTHING;"
asset=$(q "SELECT id FROM asset WHERE symbol='USDC' AND chain_id=1337 LIMIT 1")
q "INSERT INTO ledger_account (asset_id, kind) VALUES ('$asset','suspense'), ('$asset','fees') ON CONFLICT DO NOTHING;"
a=$(q "SELECT id FROM ledger_account WHERE asset_id='$asset' AND kind='suspense' AND account_id IS NULL")
b=$(q "SELECT id FROM ledger_account WHERE asset_id='$asset' AND kind='fees' AND account_id IS NULL")
for v in "$asset" "$a" "$b"; do [ "$(printf '%s' "$v" | wc -l)" -eq 0 ] && [ -n "$v" ] || { echo "expected exactly one row, got: '$v'"; exit 1; }; done
entries="[{\"ledger_account_id\":\"$a\",\"asset_id\":\"$asset\",\"amount\":\"1000000\"},{\"ledger_account_id\":\"$b\",\"asset_id\":\"$asset\",\"amount\":\"-1000000\"}]"
t1=$(q "SELECT ledger_post('smoke-1','fee',NULL,NULL,'$entries'::jsonb,'smoke')")
t2=$(q "SELECT ledger_post('smoke-1','fee',NULL,NULL,'$entries'::jsonb,'smoke')")
[ "$t1" = "$t2" ] || { echo "idempotency broken: $t1 != $t2"; exit 1; }
if q "SELECT ledger_post('smoke-2','fee',NULL,NULL,'[{\"ledger_account_id\":\"$a\",\"asset_id\":\"$asset\",\"amount\":\"5\"}]'::jsonb)" 2>/dev/null; then echo "unbalanced post accepted"; exit 1; fi
if q "DELETE FROM ledger_entry WHERE ledger_transaction_id='$t1'" 2>/dev/null; then echo "ledger_entry was deletable"; exit 1; fi
echo "ledger smoke ok: tx=$t1 entries=$(q "SELECT count(*) FROM ledger_entry WHERE ledger_transaction_id='$t1'")"
