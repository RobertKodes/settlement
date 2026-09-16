# ADR-0016: Indexer architecture

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 13, 38.16

## Context
Section 13 lists the required data services: event indexer, reorg tracker, tx status, ABI registry, portfolio aggregator, proof and L1-finalization trackers. Lineth exposes Ethereum JSON-RPC plus the `linea_*` namespace and Blockscout in the quickstart.

## Decision (leaning)
Own event indexer in TypeScript (viem) writing to a separate `indexer` database, keyed by (chain, block, log index) with reorg handling from the follower node; finality states derived from the coordinator's L1 submissions. Blockscout stays the public explorer. Evaluate a managed indexer only if throughput demands it.
