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

## Implemented 2026-09-16 (Milestone C)
- `protocol/contracts/src/account/PasskeyAccount.sol`: OpenZeppelin 5.4 `Account` (ERC-4337, EntryPoint v0.8) +
  `SignerP256` (the passkey key pair) + ERC-7821 batch execution + ERC-1271, deployed as deterministic clones by
  `PasskeyAccountFactory` (counterfactual addresses, `initCode` on the first operation).
- **RIP-7212 is not available on the devnet** at the pinned Lineth commit (a call to `0x100` with a valid vector
  returns empty even though the genesis enables Osaka at block 0). OpenZeppelin's `P256.verify` falls back to
  Solidity: a create-plus-transfer operation costs ~876k gas (two P-256 verifications: user-op signature and the
  USDC permit through ERC-1271). The verification path is an explicit constructor flag (`SOLIDITY_P256`): pure Solidity on this devnet, precompile with
  probe elsewhere. Chosen over OpenZeppelin's automatic probe because Foundry's fork simulation refuses calls to
  code-less addresses, which made every scripted deployment fail before the chain was even reached.
- Not yet: ERC-6900 modules (policies, session keys, recovery), the WebAuthn envelope
  (`authenticatorData`/`clientDataJSON` parsing) and ERC-7739 defensive rehashing for ERC-1271. All three are the
  next slice; the wire format of signatures will change from raw `r‖s` to the WebAuthn struct then.

## Consequences
Compatible with Circle Wallets and Paymaster without adapters; institutions with MPC providers connect as external signers through ERC-1271.

## Verification
Phase 2 acceptance: a passkey account created through the SDK executes a transfer on the devnet with USDC-denominated gas (Milestone C).
