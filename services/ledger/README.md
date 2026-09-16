# services/ledger — operational double-entry ledger (schema v1)

Blueprint section 12 and ADR-0015. **The chain indexer is not the ledger.** Chain events are evidence
that the ledger references (`chain_transaction`), never the accounting record itself.

## Conventions

- Every table has a `uuid` primary key (`gen_random_uuid()`), `created_at`, and where mutable `updated_at`.
- Amounts are `NUMERIC(78,0)` base units next to an `asset_id`; decimals live on `asset` per chain.
- `ledger_entry` is append-only: the trigger rejects `UPDATE` and `DELETE`. Corrections are new
  entries in a reversing `ledger_transaction`.
- Every `ledger_transaction` must balance per asset; `ledger_post()` is the only sanctioned write path
  and checks the sum in the same statement.
- Financial mutations carry an `idempotency_key`; the unique index makes a replay a no-op.
- No PII columns. Names, documents and bank details stay with the provider; we store provider IDs and
  hashed references.
- Blockchain addresses (`address`) are separate from product identities (`account`).

## Apply

```sh
make services-up          # Postgres 16 + Redis 7 (infra/docker/compose.services.yml)
make ledger-migrate       # applies migrations/*.sql in order, records them in schema_migrations
```
