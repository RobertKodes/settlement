# ADR-0013: RFQ signature and settlement standard

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 9, 10, 38.13

## Context
Institutional size needs deterministic quotes from professional makers with replay protection and expiry (`rfq_quote` table in schema v1).

## Decision (leaning)
EIP-712 signed quotes (domain = chain ID + RFQSettlement address), maker nonce + expiry, taker fills through the Router so policy checks apply. Makers register through the product layer (maker API, Phase 9).
