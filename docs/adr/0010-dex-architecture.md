# ADR-0010: DEX architecture: custom vs proven components

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 9, 38.10

## Context
Section 9 wants a StableSwap pool, a concentrated-liquidity AMM and RFQ. Section 36 forbids "fork a DEX and call it finished".

## Decision (leaning)
- StableSwap: own implementation of the Curve invariant (small, auditable, USDC/EURC first).
- Concentrated liquidity: integrate an audited, permissively licensed implementation (Uniswap v3 core is BUSL-expired and widely audited) rather than rewrite; own the router/quoter/position manager.
- RFQ: own EIP-712 settlement contract (ADR-0013).
- `foundry.toml` compiles for `prague`; the devnet genesis enables Osaka-era forks at block 0.
