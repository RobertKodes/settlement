# ADR-0018: Arc adapter design

- **Status:** Accepted (v2: Arc is a real dependency — RPC adapter live, venue deployable, StableFX gated)
- **Date:** 2026-09-16
- **Blueprint refs:** sections 4, 5, 38.18

## Context (verified 2026-09-16)
Arc is Circle's own L1 for stablecoin finance, EVM-compatible (Osaka baseline), sub-second deterministic finality, PoA at launch. **Mainnet went live 2026-09-16**: chain ID `5042`, RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`. Testnet: chain ID `5042002`, `https://rpc.testnet.arc.io`. Gas is paid in USDC: the **native** balance has 18 decimals while the ERC-20 interface at `0x3600000000000000000000000000000000000000` exposes the same USDC with 6 decimals; there is no wrapped USDC. EURC mainnet `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`, testnet `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`. Arc-specific behaviour: a system emitter at `0xffff…fffE` logs all USDC transfers, a 20 Gwei `maxFeePerGas` floor, `address(0)` sends revert, blocklist reverts consume gas without a receipt. FX engine: StableFX; opt-in confidential transfers with selective disclosure. CCTP/Gateway domain 26. `docs.arc.io/llms.txt` still says "testnet only" and must not be machine-read for network status.

## Decision
- Arc is a **peer venue**, never the base chain (section 36.4). The adapter (`integrations/circle/arc`) exposes USDC balance, StableFX/RFQ quotes and settlement status to the router; funds move to/from Arc via CCTP V2 / Gateway (ADR-0017).
- All amounts crossing the adapter boundary are ERC-20 units (6 decimals). `arcNativeToErc20Units` / `arcErc20ToNativeUnits` are the only conversion path; `hasDust` guards truncation. The chain registry records both decimals explicitly.
- Gas on Arc is budgeted in 18-decimal native units in the gas estimator, displayed in 6-decimal USDC.

## Verification
`integrations/circle/arc` tests cover the 18↔6 conversion and dust detection; `packages/config` asserts Arc's native vs ERC-20 decimals.

## References
- https://docs.arc.io/arc/references/connect-to-arc
- https://docs.arc.io/arc/references/evm-differences
- https://developers.circle.com/stablefx

## Architecture v2 note (2026-09-16)
ArcRpcAdapter reads Arc Testnet live (6/18-decimal separation). Our UniswapV2-compatible venue deploys with `make arc-deploy` once the deployer is funded; StableFX (permissioned RFQ + FxEscrow 0xe2E5…DFe6) waits for an institutional API key.
