# ADR-0004: Sequencer and operator topology

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 3, 30, 38.4

## Context
Lineth block production is Maru (QBFT consensus, in-tree `maru/`, release v1.3.0) driving a Besu sequencer; a single operator runs it today. Upstream's roadmap adds L1-enforced forced inclusion and an escape hatch (May 2026) and lists multi-operator sequencing as a later phase; a code search for "multi-operator" in the pinned commit returns nothing yet.

## Decision (leaning)
- Phase 1: one Maru validator + one sequencer + N follower RPC nodes, all ours, with the forced-inclusion path enabled so censorship is bounded by L1.
- Publish the operator roadmap (section 10 of the phases) and evaluate a QBFT validator set with independent operators once upstream ships the tooling. No token for sequencer economics (section 30).

## Open items
Follower-node count and geography, RPC gateway product, sequencer key custody (Web3Signer/KMS).
