# ADR-0021: Key management: MPC, HSM, hot/warm/cold

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 14, 16, 38.21

## Context
Sequencer, coordinator, paymaster, Gateway depositor EOAs, treasury and governance roots all need keys with different blast radii; application servers must never hold raw private keys casually (section 14).

## Decision (leaning)
Web3Signer/KMS for chain-operator keys (as the quickstart already models), MPC provider for institutional hot signing, hardware/offline multisig for governance and treasury roots, short-lived scoped service credentials for APIs, documented compromise procedure per key class. The quickstart's committed dev keys (`config/DEV-KEYS-INVENTORY.md`) are never reused outside the local devnet.
