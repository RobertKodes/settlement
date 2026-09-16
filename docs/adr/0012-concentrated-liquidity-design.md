# ADR-0012: Concentrated-liquidity design

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 9, 38.12

## Context
Volatile pairs (ETH/USDC, ERC-20/USDC) need capital-efficient liquidity and a TWAP source for the oracle layer.

## Decision (leaning)
Uniswap v3-style ticks and fee tiers; positions as NFTs managed by our PositionManager; TWAP exposed to `OracleAdapter` as one input, never the sole security oracle (section 19).
