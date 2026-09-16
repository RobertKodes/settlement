# ADR-0020: Oracle providers and fallback rules

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 19, 38.20

## Context
Non-stable assets, risk limits and some settlement products need prices; a thin native pool's spot price must never be the sole security oracle (section 19).

## Decision (leaning)
`OracleRegistry` with a primary external feed (Chainlink where available on our L2; otherwise a Pyth pull feed), a secondary (native TWAP), freshness and deviation limits, and a circuit-break policy per market. Five price roles kept distinct: execution, TWAP, external reference, accounting, risk.
