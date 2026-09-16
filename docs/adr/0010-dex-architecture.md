# ADR-0010: DEX architecture: custom vs proven components

- **Status:** Accepted for the devnet (concentrated liquidity and RFQ still Proposed)
- **Date:** 2026-09-16
- **Blueprint refs:** sections 9, 38.10

## Context
Section 9 wants a StableSwap pool, a concentrated-liquidity AMM and RFQ. Section 36 forbids "fork a DEX and call it finished".

## Decision
- StableSwap: own implementation of the Curve invariant (small, auditable, USDC/EURC first).
- Concentrated liquidity: integrate an audited, permissively licensed implementation (Uniswap v3 core is BUSL-expired and widely audited) rather than rewrite; own the router/quoter/position manager.
- RFQ: own EIP-712 settlement contract (ADR-0013).
- `foundry.toml` compiles for `prague`; the devnet genesis enables Osaka-era forks at block 0.

## Implemented 2026-09-16
`protocol/contracts/src/dex/StableSwapPool.sol`: two-asset Curve invariant with rate multipliers, fee on output, imbalance fee on
deposits, bounded owner controls (fee ≤ 1%, A moves ≤ 2x per call), deadline + minOut on trades. Fuzz tests prove no free
round trip and monotone virtual price. Deployed by `make devnet-deploy` with 5M/5M USDC/EURC. The router
(`packages/router`) executes swaps on it through the account's ERC-7821 batch (approve + exchange).
