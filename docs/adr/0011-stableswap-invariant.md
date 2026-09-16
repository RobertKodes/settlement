# ADR-0011: StableSwap invariant

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 9, 38.11

## Context
USDC/EURC is the first market; both are 6-decimal stablecoins with a non-pegged FX rate.

## Decision (leaning)
Curve-style invariant with an amplification parameter and, because USDC/EURC floats, a rate oracle or a dynamic peg (as in Curve's crypto pools) rather than a 1:1 assumption. Invariant and fuzz tests are the gate (section 9 protections list).
