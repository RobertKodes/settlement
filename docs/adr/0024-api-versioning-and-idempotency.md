# ADR-0024: API versioning and idempotency rules

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 13, 28, 38.24

## Context
Sections 13 and 28: stable product APIs, versioned from day one, every write authenticated, authorized, idempotent, request-id'd, audited, with deterministic error codes.

## Decision
The rules in `docs/api/conventions.md` are binding: `/v1` path versioning with a 6-month deprecation window; `Idempotency-Key` required on financial writes, retained 24 h, same-payload replay returns the original response, different payload returns `409 idempotency_conflict`; `X-Request-Id` on every response and audit row; error envelope `{ error: { code, message, details, requestId } }`; base-unit string amounts; RFC 3339 UTC; cursor pagination; HMAC-SHA256 signed webhooks with timestamp and id headers.

## Verification
Schema v1 carries `idempotency_key` unique indexes on `intent`, `fiat_transfer`, `ledger_transaction` and `audit_event.request_id`. API conformance tests are added with the first service (Phase 2).
