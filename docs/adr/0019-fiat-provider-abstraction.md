# ADR-0019: Fiat-provider abstraction

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 11, 17, 38.19

## Context
Fiat is a regulated edge outside the protocol. Bridge (`https://apidocs.bridge.xyz/`) offers customers/KYC, external accounts, transfers, virtual accounts, liquidation addresses and webhooks; sandbox `https://api.sandbox.bridge.xyz/v0/` (keys `sk-test…`, granted by Bridge support) reliably exercises only customer creation and KYC. Rails: USD wire/ACH/FedNow, EUR SEPA (+Instant), GBP FPS, BRL Pix, MXN SPEI, COP.

## Decision
- The product depends only on the `FiatProvider` interface in `integrations/fiat` (method list exactly as blueprint section 11). Provider identity is a column (`provider_customer.provider`, `beneficiary.provider`), never a code path.
- Bridge is the first implementation (Phase 8); the mapping is recorded in `integrations/fiat/src/bridge/README.md` before any code.
- Bank details and identity documents never enter our database: we store provider ids, onboarding state and display masks only.
- Every inbound webhook is verified (`webhookVerify`) and de-duplicated on event id; returns/reversals are ledger reversals, not edits.
- No claim that Bridge or Circle acts as a regulated intermediary unless an agreement says so (section 17); legal review per jurisdiction before production.

## Verification
`MockFiatProvider` tests (idempotent on-ramp creation, webhook rejection); schema `fiat_transfer` state machine.
