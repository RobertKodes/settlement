# Status against the blueprint — 2026-09-16

The record of what exists, what is verified, and what is blocked, per blueprint phase (section 32) and
milestone (section 39). "Verified" means a test or a scripted run passed on the local devnet today.
Nothing here runs on a public network yet.

## Milestones (section 39)

| milestone | definition | status | evidence |
|---|---|---|---|
| A — boot | `make devnet-up / status / down` | **done** | `chain/scripts/*`, resume keeps state; L1 31648428 + L2 1337 |
| B — prove | tx → L2 → batch → prove → finalize on L1 → status exposed | **done (dev prover)** | `make devnet-status` "L1 finality: finalized L2 block N of M"; `GET /v1/settlements/:id` moves SETTLED → PROVEN. Real proofs need an amd64 host (ADR-0005) |
| C — account | smart account → fund with test USDC → send → fee without user ETH | **done** | `PasskeyAccount` + `USDCPaymaster`; `make devnet-milestone-c`; `packages/chain` devnet test; API transfer flow |
| D — exchange | USDC/EURC pool → add liquidity → quote → swap → index → ledger → receipt | **done** (index = ledger + chain_transaction rows; no standalone indexer) | `StableSwapPool`, `swap` intents end to end |
| E — route | compare native vs Arc/external → simulate → execute chosen → reconcile | **done** (Arc quoted, not executable; simulation = on-chain quote) | `packages/router`, ranked venues in the quote, `POST /v1/reconciliation/run` |
| F — settle | two institutions → approval policy → DvP/PvP → atomic → proof/finality → receipt | **done** | `DvPSettlement`, policies, `/sign` `/approve` `/execute`, DvP devnet test |
| G — fiat | provider sandbox → fiat test flow → stablecoin → account → reverse → reconciliation | **done with the mock provider** | `/v1/fiat/*`, verified webhook credits USDC once, reconciliation clean. Bridge sandbox needs credentials from Bridge support (blocked externally) |

## Phases (section 32)

| phase | status | notes |
|---|---|---|
| 0 architecture lock | done | 25 ADRs (`docs/adr`), schema v1, API conventions, security model, monorepo + CI |
| 1 Lineth network | local done; shared devnet not started | local L1+L2+coordinator+dev prover+explorer (Blockscout via quickstart). Sepolia-settled shared devnet needs a funded deployer and an amd64 prover host |
| 2 accounts + money | done on devnet | test USDC/EURC, passkey accounts, transfers, USDC-denominated gas, ledger, account APIs. Missing: WebAuthn envelope, ERC-6900 modules, ERC-7739, a real bundler (the API's bundler key submits `handleOps` itself) |
| 3 native liquidity | partial | StableSwap done with fuzz/invariant tests; concentrated-liquidity pool, LP UI, DEX UI, oracle layer not started |
| 4 Arc integration | interface + mock | adapter and router venue exist; live Arc connectivity requires CCTP/Gateway support for our chain (ADR-0017/0018) |
| 5 CCTP + Gateway | interface + mock | adapters typed against the V2 contracts and Gateway API; no live transfers (our chain has no domain) |
| 6 institutional settlement | done on devnet | DvP/PvP, approval policies, receipts, reconciliation; escrow/batch/scheduled settlement not started; counterparty registry = account handles |
| 7 consumer/business UX | not started | no apps; the SDK (`packages/sdk`) is the client surface |
| 8 fiat rails | mock provider | Bridge mapping documented; live sandbox blocked on credentials; legal review not started |
| 9 RFQ | not started | `rfq_quote` table and ADR-0013 only |
| 10 public ecosystem | partial | SDK, docs, explorer (local). No public RPC, faucet, status page, or contract registry |

## What is deliberately not claimed

- No real ZK proofs were produced (dev prover on Apple Silicon); L1 finality on the devnet is the coordinator's
  real submission pipeline with dummy proofs.
- No Circle-issued USDC anywhere; every stablecoin is a devnet test token (ADR-0007).
- The API has no authentication: `X-Account-Id` names the caller. Passkey signatures are the only real authorization.
- The approval-policy engine covers thresholds only; N-of-M roles, recipient allowlists and agent budgets are schema-only.
- `POLICY_CHECKED` for single-party intents applies the sender's thresholds; nothing else.
- The devnet chain id 1337 is temporary (ADR-0002) and the license is undecided.

## How to reproduce everything

```sh
make bootstrap && make devnet-up && make devnet-deploy && make devnet-milestone-c
make services-up && make ledger-migrate
make test                                            # 22 Foundry tests, unit tests across packages
pnpm --filter @settlement/chain test:devnet           # Milestone C from TypeScript
pnpm --filter @settlement/api test:devnet             # transfer, swap, DvP, fiat, SDK flows on the devnet
```

## Recommended next steps, in order

1. Shared devnet on Sepolia with an amd64 prover host: Milestone B with real proofs.
2. WebAuthn envelope in `PasskeyAccount` and a browser passkey signer for the SDK; ERC-6492 for counterfactual ERC-1271.
3. A bundler (or bundler RPC) and the ERC-6900 module layer for policies and session keys.
4. Bridge sandbox credentials, then swap `MockFiatProvider` for the Bridge adapter behind the same routes.
5. Circle conversation: native USDC, CCTP domain and Gateway support for the chain (section 35).
