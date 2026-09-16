# ADR-0007: Canonical USDC representation before Circle native support

- **Status:** Accepted for the local devnet (shared-devnet bridging still Proposed)
- **Date:** 2026-09-16
- **Blueprint refs:** sections 4, 35, 38.7

## Context
Native USDC on Linea does not imply native USDC on a new Lineth deployment; Circle must support the chain (CCTP domain, Gateway, native issuance). Until then the L2 needs a USDC representation for Phase 2 and 3 work.

## Decision
Bridge Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) through the canonical Lineth token bridge (`deploy-token-bridge-l1/l2` in the upstream contracts) on the shared devnet, and mint a plain test ERC-20 named `USDC` (6 decimals) on the local devnet. The bridged asset is registered in `packages/config` as `USDC` on `l2-devnet` with a `notes` entry saying it is not Circle-issued. Never describe the network as "USDC-backed".

## Implemented 2026-09-16
`protocol/contracts/src/TestUSDC.sol` (6 decimals, EIP-2612 permit, owner-mintable) is deployed by
`make devnet-deploy`; its address lives in the gitignored `chain/lineth/deployments.local.json`, never in
`packages/config`, so nothing can mistake it for a canonical USDC.

## Open items
Migration plan from bridged to native USDC (Circle's standard is a burn/mint swap), and the Circle partnership milestone (section 35).
