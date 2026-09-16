# ADR-0007: Canonical USDC representation before Circle native support

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 4, 35, 38.7

## Context
Native USDC on Linea does not imply native USDC on a new Lineth deployment; Circle must support the chain (CCTP domain, Gateway, native issuance). Until then the L2 needs a USDC representation for Phase 2 and 3 work.

## Decision (leaning)
Bridge Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) through the canonical Lineth token bridge (`deploy-token-bridge-l1/l2` in the upstream contracts) on the shared devnet, and mint a plain test ERC-20 named `USDC` (6 decimals) on the local devnet. The bridged asset is registered in `packages/config` as `USDC` on `l2-devnet` with a `notes` entry saying it is not Circle-issued. Never describe the network as "USDC-backed".

## Open items
Migration plan from bridged to native USDC (Circle's standard is a burn/mint swap), and the Circle partnership milestone (section 35).
