# ADR-0015: Internal ledger architecture

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 12, 27, 38.15

## Context
Chain indexing is evidence, not accounting (section 36.9). Institutions need a double-entry record with reversals, idempotent mutations and reconciliation against chain and fiat providers.

## Decision
- PostgreSQL, plain SQL migrations (`services/ledger/migrations/`), no ORM-generated schema. Schema v1 covers every section 27 entity.
- Double entry: `ledger_transaction` + `ledger_entry` (signed base-unit amounts). `ledger_post()` is the only write path and rejects unbalanced entries per asset; entries are append-only (trigger). Corrections are reversing transactions.
- Every financial mutation has an `idempotency_key` with a unique index.
- Chain facts live in `chain_transaction` and are referenced by id; balances are a rebuildable projection.
- Unique constraints that include nullable columns use `NULLS NOT DISTINCT` so house accounts (NULL `account_id`) and native assets (NULL `address`) cannot duplicate.

## Verification
`make services-up && make ledger-migrate` twice (second is a no-op) and `services/ledger/smoke.sh` (balanced post, idempotent replay, unbalanced post rejected, entry deletion rejected). CI job `schema`.
