# ADR-0025: Compliance boundary between protocol and hosted services

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 11, 17, 38.25

## Context
Section 17: the Lineth network, public RPC, contracts, DEX and self-custody transfers are permissionless; fiat ramps, hosted accounts, institutional onboarding, regulated assets and jurisdiction-restricted features are controlled services.

## Decision (leaning)
Compliance state (`compliance_state`) and policy enforcement live entirely in the product layer and in account-level ERC-6900 modules that the account owner opts into; nothing in the sequencer or contracts gates by identity. Regulated assets ship as separate token contracts with their own transfer restrictions, not as network rules. Specialist legal advice per jurisdiction before any production fiat, securities or custody feature.
