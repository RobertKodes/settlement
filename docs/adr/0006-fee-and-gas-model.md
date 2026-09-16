# ADR-0006: Fee and gas model

- **Status:** Accepted for the devnet (price oracle and production paymaster funding still Proposed)
- **Date:** 2026-09-16
- **Blueprint refs:** sections 15, 31, 38.6

## Context
The normal user must not hold ETH to use a USDC-native product. Circle Paymaster (ERC-4337 v0.7/v0.8, EIP-2612 permit encoded in `paymasterData`) exists only on Circle-supported chains; our chain has none until Circle supports it. Lineth's protocol gas asset is ETH (`linea_estimateGas` returns a 7 wei base fee locally).

## Decision
- Protocol level: ETH gas as Lineth ships it; no custom gas token (it would fork the stack).
- Product level: our own ERC-4337 paymaster on the L2 that charges USDC via permit, mirroring Circle Paymaster's interface so the switch is a config change when Circle supports the chain. Sponsored gas for onboarding flows behind rate limits.
- Fees quoted to users in USDC, as `fees.network` in the quote (section 28).

## Implemented 2026-09-16 (Milestone C)
`protocol/contracts/src/paymaster/USDCPaymaster.sol` on `account-abstraction` v0.8 `BasePaymaster`: the same
`paymasterAndData` layout as Circle Paymaster (`mode ‖ token ‖ permitAmount ‖ permitSignature`), EIP-2612 permit
accepted through ERC-1271 for contract accounts, prefund pulled at the maximum cost, surplus refunded in `_postOp`,
`UserOperationSponsored` event. Price is an owner-set `tokenPerEth` stub. Verified in `test/MilestoneC.t.sol` and on
the devnet by `make devnet-milestone-c`.

## Open items
Paymaster funding/rebalancing policy, abuse controls, EIP-7702 for EOAs.
