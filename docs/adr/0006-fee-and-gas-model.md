# ADR-0006: Fee and gas model

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 15, 31, 38.6

## Context
The normal user must not hold ETH to use a USDC-native product. Circle Paymaster (ERC-4337 v0.7/v0.8, EIP-2612 permit encoded in `paymasterData`) exists only on Circle-supported chains; our chain has none until Circle supports it. Lineth's protocol gas asset is ETH (`linea_estimateGas` returns a 7 wei base fee locally).

## Decision (leaning)
- Protocol level: ETH gas as Lineth ships it; no custom gas token (it would fork the stack).
- Product level: our own ERC-4337 paymaster on the L2 that charges USDC via permit, mirroring Circle Paymaster's interface so the switch is a config change when Circle supports the chain. Sponsored gas for onboarding flows behind rate limits.
- Fees quoted to users in USDC, as `fees.network` in the quote (section 28).

## Open items
Paymaster funding/rebalancing policy, abuse controls, EIP-7702 for EOAs.
