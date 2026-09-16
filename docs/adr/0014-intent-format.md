# ADR-0014: Intent format v1

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 7, 28, 38.14

## Context
The intent is the product's primary input (section 7). It must be validated identically by the API, the router and the SDK, and readable by non-TypeScript consumers.

## Decision
- Canonical definition: `packages/types/src/intent.ts` (zod). JSON Schema is generated into `packages/types/schema/` on every build and committed.
- Amounts are base-unit integer strings; decimals are looked up per (asset, chain) in `@settlement/config`. Recipients are account handles, never raw addresses at this layer.
- Lifecycle: the section 7 states plus explicit terminal failures `FAILED_AUTHORIZATION | FAILED_QUOTE | FAILED_POLICY | FAILED_EXECUTION | EXPIRED | CANCELLED`. Transitions are the `INTENT_TRANSITIONS` table; once `EXECUTING`, the only exits are `SETTLED` or `FAILED_EXECUTION`.
- Venues are `native | arc | external` at the intent level; concrete venue ids (`native-stableswap`, `arc-rfq`) appear in quotes and receipts.

## Implemented 2026-09-16
`services/api` drives the lifecycle for `transfer` intents on the devnet: CREATED → AUTHORIZED (implicit, account
owner) → QUOTED (unsigned op + digests) → POLICY_CHECKED (placeholder) → ROUTE_LOCKED → EXECUTING → SETTLED →
PROVEN (when the L1 rollup contract has finalized the block). Failures land in FAILED_QUOTE / FAILED_EXECUTION
with a `failure_code`. State needed by later steps lives in `intent.body.state` (quote draft, tx hash, ledger refs).

## Verification
`packages/types` tests parse the blueprint's section 7 and 28 examples verbatim and prove the transition table never moves backwards.
