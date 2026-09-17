# Settlement platform monorepo

A USDC-native **institutional settlement platform** that *uses* three real infrastructures and owns the layer
connecting them:

| infrastructure | our use of it | who runs it |
|---|---|---|
| **Arc** (Circle's L1) | money home and venue: USDC/EURC, our UniswapV2-compatible pools that Metapad launches graduate into, StableFX for institutional FX, gas paid in USDC | Circle |
| **Lineth rollup** (our instance of the LFDT Lineth stack) | private ZK-proven settlement layer: DvP/PvP contracts, institutional passkey accounts, policy-enforced execution, receipts, state proven to Ethereum | us (sequencer), Ethereum verifies |
| **Circle stack** (USDC, CCTP V2, Gateway) and **Bridge** | the rails between chains and the fiat edge | Circle, Bridge |

What we own: the unified institutional account, intent engine, policy engine, smart router (plans across
systems), settlement engine, ledger with provenance, reconciliation, fiat orchestration, API, SDK and the
Settlement Terminal. **This is not a new public blockchain**: the rollup is settlement infrastructure of the
platform, not a chain marketed to third parties. Read `docs/ARCHITECTURE_V2.md` first, then
`docs/STATUS.md` (what is done, mocked or externally blocked) and `docs/METAPAD_HANDOFF.md`.

> Account -> Intent -> Policy -> Route plan (legs across Lineth · Arc · CCTP · fiat) -> Execution -> Settlement -> Proof

There is no brand yet. Code uses the neutral scope `@settlement/*`; `make check-name` keeps the dropped draft name
out of the tree. Decisions live in `docs/adr/` (ADRs win over the original blueprint in `docs/architecture/`).

## Prerequisites

| tool | minimum | notes |
|---|---|---|
| Docker | 24 | this machine uses Colima: `colima start --cpu 6 --memory 12` |
| Docker Compose | 2.19 | `brew install docker-compose` + symlink into `~/.docker/cli-plugins` |
| Node.js | 22 | `.nvmrc` |
| pnpm | 9 | `corepack enable` |
| Foundry | any 1.x | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| GNU make | 3.81 | macOS default is fine |

Docker needs **8 GB RAM** and **~30 GB disk** for the local rollup (dev prover; the real prover image is
amd64-only, see ADR-0005).

## First run

```sh
make doctor              # checks every tool above and prints the fix for anything missing
make bootstrap           # pnpm install + forge-std + sparse clone of the pinned Lineth commit
make devnet-up           # local Lineth rollup: L1 (Besu+Teku) + L2 (Maru+Besu) + coordinator + dev prover
make devnet-status       # chain IDs, block heights, L1 finality, service table
make devnet-deploy       # test USDC/EURC, StableSwap, DvP, venue (UniswapV2-compatible) on the rollup
make devnet-milestone-c  # EntryPoint v0.8 + passkey account + USDC-paid gas, end to end
make services-up         # Postgres 16 (:5439) + Redis 7 (:6389) for the ledger
make ledger-migrate      # applies services/ledger/migrations/*.sql
make test                # forge tests + vitest across packages
pnpm --filter @settlement/api dev        # API on :3000 (reads chain/lineth/deployments.local.json)
pnpm --filter @settlement/api test:devnet # transfer, swap, DvP, fiat and SDK flows end to end
pnpm --filter @settlement/terminal dev   # Settlement Terminal on :5173 (proxies /v1 to the API)
```

Arc Testnet (real chain 5042002): `make arc-key` generates a deployer, fund it with testnet USDC at
https://faucet.circle.com, then `make arc-deploy` puts the venue, accounts and DvP on Arc and
`make arc-status` shows them. `GET /v1/systems` reports what the platform can reach and what is blocked.

`make help` lists everything. Devnet RPCs: L1 `http://localhost:8445` (chain 31648428), L2 sequencer
`http://localhost:8645` (chain 1337, `linea_*` namespace). `make devnet-down` keeps state (resume with
`devnet-up`); `make devnet-reset` wipes volumes.

## Repository map

| path | what is there | status |
|---|---|---|
| `chain/lineth/`, `chain/scripts/` | pinned Lineth commit, devnet env, boot/status/resume/deploy scripts | done |
| `chain/arc/`, `chain/deployments/` | Arc Testnet deployer tooling (`arc-key`, `arc-deploy`, `arc-status`), per-chain deployment files | awaiting funding |
| `protocol/contracts/` | Foundry: `PasskeyAccount` + factory (ERC-4337 v0.8, P-256, ERC-7821), `USDCPaymaster`, `DvPSettlement`, `StableSwapPool`, **`venue/` UniswapV2-compatible factory/pair/router (Metapad graduation target)**, test stablecoins, deploy scripts for the rollup and for Arc | done, 27 tests |
| `packages/router/` | `@settlement/router`: **route plans with legs across Lineth / Arc / CCTP / Gateway / fiat / Metapad**, venue-v2, StableSwap, CCTP, StableFX and Metapad-curve adapters, all-in scoring; BLOCKED legs carry their reason | done |
| `packages/chain/` | `@settlement/chain`: viem clients, passkey signing, user-op building, paymaster data, submission, L1-finality reads | done |
| `packages/sdk/` | `@settlement/sdk`: `SettlementClient` — createAccount, transfer, swap, settle (DvP) with a `Signer` | done |
| `packages/types/`, `packages/config/`, `packages/contracts-abi/` | schemas (intent/quote/receipt), chain registry with chain-scoped decimals + CCTP domains + Circle/Bridge endpoints, generated ABIs | done |
| `integrations/circle/arc/` | `ArcRpcAdapter` (live Arc RPC, 6/18-decimal separation, venue quotes) + StableFX typing (key-gated) | live read-only |
| `integrations/circle/cctp/` | `CctpV2Client` (burn, IRIS v2 attestation polling, mint; sandbox) | needs funded keys |
| `integrations/circle/gateway/` | typed client + mock | mock |
| `integrations/fiat/` | `FiatProvider` interface, `BridgeFiatProvider` (sandbox API), mock | needs credentials |
| `services/api/` | `@settlement/api`: passkey accounts, intents (quote / authorize / execute), approval policies, two-party DvP, planner-based swaps, ledger posting, receipts with L1 finality, fiat routes with verified webhooks, reconciliation runs, unified-account portfolio with provenance, `/v1/systems`, `/v1/routes/plan`; Postgres repositories | done on the rollup |
| `services/ledger/` | schema v1 + 0002/0003, `ledger_post()`, migrate/smoke scripts | done |
| `apps/terminal/` | **Settlement Terminal**: unified account with provenance, intent composer, lifecycle rail, plan legs per system, quorum ring, receipts with proof timeline, command line + palette | done |
| `infra/`, `.github/workflows/ci.yml` | services compose; CI jobs `ts`, `contracts`, `schema`, `name-check` | done |
| `docs/` | `ARCHITECTURE_V2.md`, `STATUS.md`, `METAPAD_HANDOFF.md`, 25 ADRs, API conventions, original blueprint | done |
| `security/threat-model/` | threat table with mitigation status | done |

## External dependencies, stated plainly

| needs | from | until then |
|---|---|---|
| testnet USDC on the Arc deployer `0xA619669f69E500353C7cd7A508232043Dc416fEd` | owner (faucet.circle.com) | Arc legs are BLOCKED, Arc reads work |
| CCTP domain + native USDC for the Lineth rollup | Circle | rollup uses test stablecoins; Lineth↔Arc value legs BLOCKED |
| StableFX institutional API key | Circle representative | Arc FX uses our venue; StableFX adapter mocked |
| Bridge sandbox credentials | Bridge support | `MockFiatProvider` behind the same routes |
| amd64 prover host + Sepolia deployer | owner | rollup proofs stay in dev mode locally |

## Conventions

- TypeScript: strict, ESM, `NodeNext`; Biome for lint and format (`make lint`, `make lint-fix`); Vitest.
  Amounts are base-unit strings with a chain; decimals come from the registry, never a global constant.
- Solidity: Foundry, `forge fmt`, tests next to every contract; ABIs regenerate with `pnpm gen:abi`.
- SQL: plain migrations, append-only ledger, idempotency keys on every financial write.
- Every change to contracts, adapters or auth updates `security/threat-model/README.md` or says why not.
- License: not decided yet (`"license": "UNLICENSED"`); decide before anything is published.
