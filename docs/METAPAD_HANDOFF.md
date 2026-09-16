# Metapad × Settlement — response to the handoff (2026-09-17)

For Angus and Metapad's Claude. Everything below exists in `RobertKodes/settlement` on `main` and is verified
by tests; the Arc-side deployment waits only for testnet funding.

## What we agree on
- Lineth rollup = ZK-proven settlement layer (DvP/PvP, institutional accounts, receipts), operated by us, proving
  to Ethereum. It is **not** the cross-chain transport and **not** a public chain. `docs/ARCHITECTURE_V2.md`.
- Arc = money home and venue. CCTP V2 (Arc domain 26) and Gateway move USDC. Bridge is the fiat edge.
- Build order: (1) the venue on Arc, (2) the control surface with live CCTP and Bridge, (3) the rollup once Circle
  commits a CCTP domain for it. Phase 1 is Metapad-side, Phase 2 settlement-side, Phase 3 joint.

## What Metapad graduates into (ready now)
`protocol/contracts/src/venue/`: `VenueFactory`, `VenuePair`, `VenueRouter`, UniswapV2-compatible.
- `VenueFactory.createPair(tokenA, tokenB)` → CREATE2 pair, predictable with `pairFor(tokenA, tokenB)`
  (so `LaunchToken` can block pre-graduation transfers to its future pool).
- `VenuePair.mint(to)` after transferring both sides (your `UniswapV2Migrator` flow: transfer raise + 200M
  reserve, mint LP to `0x…dEaD`). `test/Venue.t.sol::test_graduationMintsLockedLiquidity` replays exactly that.
- `VenueRouter.getAmountsOut / swapExactTokensForTokens / addLiquidity / removeLiquidity` for trading after graduation.
- Quote token on Arc: USDC ERC-20 view `0x3600000000000000000000000000000000000000` (6 decimals).
- Deployed on our Lineth devnet by `make devnet-deploy`; on Arc Testnet by `make arc-deploy` once the deployer
  `0xA619669f69E500353C7cd7A508232043Dc416fEd` holds testnet USDC (faucet.circle.com). Addresses land in
  `chain/deployments/arc-testnet.json`; the API serves them at `GET /v1/systems`.

## What the control surface already does for a launch or trade
- Router plans with legs across systems (`POST /v1/routes/plan`): `curve-buy` legs use your curve math
  (1.073B virtual tokens, 800M on the curve, graduation when the curve sells out; `packages/router/src/adapters-v2.ts`),
  `pool-swap` legs use our venue, `cctp-transfer` legs use Circle's rails, and every leg that cannot run yet says why.
- Intents, policy (approval thresholds), passkey accounts, USDC-paid gas, DvP settlement, ledger with provenance,
  reconciliation, receipts with L1 finality, fiat on/off-ramp routes, SDK (`packages/sdk`), Settlement Terminal UI.

## What we need from Metapad
1. The `LaunchpadFactory` / launchpad ABI and the `UniswapV2Migrator` deployment parameters, so the `metapad-curve`
   leg can execute (today it quotes only) and graduation can point at our `VenueFactory` on Arc.
2. Confirmation of the quote-token convention on Arc (USDC ERC-20 view, 6 decimals) and the presets ($1k/$2.5k/$5k).
3. A shared Arc Testnet: fund our deployer, or we fund yours; then we both deploy and run one launch end to end.

## External blockers (not code)
Circle: CCTP domain + native USDC for the rollup; StableFX institutional API key. Bridge: sandbox credentials.
Legal: fiat, securities, custody review per jurisdiction. Recorded in `docs/STATUS.md` and `docs/ARCHITECTURE_V2.md` §7.
