# ADR-0017: Cross-chain abstraction: CCTP V2 and Gateway

- **Status:** Accepted (v2: CCTP V2 client implemented against the sandbox; Lineth rollup still has no domain)
- **Date:** 2026-09-16
- **Blueprint refs:** sections 4, 8, 38.17

## Context (verified 2026-09-16)
- CCTP **V2** is current; V1 is legacy. Contracts `TokenMessengerV2`, `MessageTransmitterV2`, `TokenMinterV2`. `depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold)`; `depositForBurnWithHook` adds `hookData` (metadata only). Fast = `minFinalityThreshold <= 1000` (seconds, onchain fee, `maxFee >= getMinFeeAmount`), Standard = `>= 2000` (hard finality, ~13–19 min, no fee). Attestations: `GET https://iris-api[-sandbox].circle.com/v2/messages/{sourceDomain}?transactionHash=…`.
- Domains: Ethereum 0, Avalanche 1, OP 2, Arbitrum 3, Solana 5, Base 6, Polygon 7, Unichain 10, **Linea 11**, Codex 12, Sonic 13, World Chain 14, Sei 16, HyperEVM 19, **Arc 26**. Linea Standard transfers wait for L1 finality.
- Gateway: `GatewayWallet` (deposit/withdraw, 7-day trustless withdrawal) + `GatewayMinter.gatewayMint(attestation, signature)`; API `https://gateway-api[-testnet].circle.com/v1` (`/balances`, `/transfer`, `/info`); burn intents are EIP-712 and **EOA-signed only** on EVM, max 16 per request; mainnet live.
- Our chain has **no CCTP domain and no Gateway support** until Circle adds it (section 36.3).

## Decision
- USDC moves between supported chains only through CCTP V2 (canonical) or Gateway (unified balance). No third-party bridges for USDC.
- Interfaces live in `integrations/circle/{cctp,gateway}` with in-memory mocks; the router treats `sourceDomain -> destinationDomain` as a first-class route leg with `minFinalityThreshold` modelled as `FinalityThreshold.FAST | STANDARD`, never a boolean.
- Always set `destinationCaller` to our receiving contract; de-duplicate messages by (sourceDomain, nonce); reconcile in-flight transfers in `reconciliation_run` scope `cctp`/`gateway`.
- Gateway depositor signing uses a dedicated EOA per institution (hot-wallet policy in ADR-0021) because smart accounts cannot sign burn intents today.
- Development runs against supported testnets (Sepolia ↔ Arc Testnet, faucet `https://faucet.circle.com`) until our chain is supported.

## Verification
`packages/config` tests pin the domain table; adapter mocks enforce the Fast-fee rule and the 16-intent cap.

## References
- https://developers.circle.com/cctp/evm-smart-contracts
- https://developers.circle.com/cctp/concepts/finality-and-block-confirmations
- https://developers.circle.com/gateway/references/technical-guide

## Architecture v2 note (2026-09-16)
CctpV2Client in integrations/circle/cctp (burn, IRIS v2 attestation polling, mint). Live legs need funded keys on two CCTP chains; the Lineth rollup's legs are BLOCKED by design until Circle grants a domain.
