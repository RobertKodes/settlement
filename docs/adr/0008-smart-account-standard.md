# ADR-0008: Smart-account standard

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 6, 14, 38.8

## Context
Circle Modular Wallets are ERC-4337 accounts implementing ERC-6900 (modular), with passkey signers (WebAuthn, secp256r1) and gas sponsorship. Circle Paymaster supports EntryPoint v0.7 and v0.8. Institutional custody (MPC, multisig) and external EOAs must also work. Verified 2026-09-16; the exact EntryPoint version Circle's modular accounts deploy against is not stated on the public pages.

## Decision
- Account standard: **ERC-4337 with EntryPoint v0.8 + ERC-6900 modules**, so Circle's accounts and any ERC-6900-compatible account work unchanged. ERC-1271 signature validation is required for every contract account.
- Passkeys are the default consumer signer (secp256r1). Open item to resolve in Phase 2: whether the Besu L2 exposes the RIP-7212 P-256 precompile; if not, the account uses a Solidity verifier and the gas cost is measured.
- EIP-7702 is evaluated in Phase 2 for EOA users, not assumed.
- Policies (N-of-M approvals, limits, allowlists, agent budgets) are ERC-6900 validation/hook modules, mirrored in `policy` rows for the product layer.

## Consequences
Compatible with Circle Wallets and Paymaster without adapters; institutions with MPC providers connect as external signers through ERC-1271.

## Verification
Phase 2 acceptance: a passkey account created through the SDK executes a transfer on the devnet with USDC-denominated gas (Milestone C).
