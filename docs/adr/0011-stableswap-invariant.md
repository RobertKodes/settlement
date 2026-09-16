# ADR-0011: StableSwap invariant

- **Status:** Accepted (devnet); dynamic peg for USDC/EURC still open
- **Date:** 2026-09-16
- **Blueprint refs:** sections 9, 38.11

## Context
USDC/EURC is the first market; both are 6-decimal stablecoins with a non-pegged FX rate.

## Decision
Curve-style invariant with an amplification parameter and, because USDC/EURC floats, a rate oracle or a dynamic peg (as in Curve's crypto pools) rather than a 1:1 assumption. Invariant and fuzz tests are the gate (section 9 protections list).

## Implemented 2026-09-16
A=200, fee 0.04% on the devnet pool; USDC/EURC is treated as a 1:1 stable pair for now, which is wrong for a floating FX
pair (the pool will drift to the market rate through arbitrage and LPs bear it). ADR-0020's rate oracle must feed a
dynamic peg before real value.
