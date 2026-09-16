# ADR-0003: Data availability configuration

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 3, 38.3

## Context
Lineth publishes L2 data to Ethereum as EIP-4844 blobs; the quickstart exposes `LINEA_COORDINATOR_DATA_AVAILABILITY` and today supports `ROLLUP` only. Upstream also ships a validium mode (`make start-env-with-validium`). Institutional settlement receipts (section 10) promise L1 finality state, which presumes data is on Ethereum.

## Decision (leaning)
Rollup mode with blob DA on Ethereum. Validium is rejected for the settlement network: the product's finality claim rests on Ethereum holding the data. Revisit only if blob costs make small settlements uneconomic, and then via a compression/batching policy, not by leaving Ethereum.

## Open items
Blob fee caps for Sepolia/mainnet (`L1_BLOB_MAX_FEE_PER_*` in the quickstart env), conflation deadline tuning, and the cost-per-settlement metric (section 37).
