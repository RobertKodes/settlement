# Settlement network monorepo

A USDC-native institutional settlement network built as a **Lineth** ZK rollup (EVM-equivalent,
proofs verified on Ethereum), unifying fiat, USDC/EURC, ERC-20 assets, EVM applications and
cross-chain liquidity behind one programmable account and one intent interface:

> Account -> Intent -> Coordination -> Execution -> Settlement -> Proof

There is no brand yet. Code uses the neutral scope `@settlement/*`, the chain key `l2-devnet` and
the phrase "the network"; renaming later is one find-and-replace, and `make check-name` keeps the
dropped draft name out of the tree.

The end-state design is `docs/architecture/USDC_Lineth_Institutional_Settlement_Master_Blueprint.md`;
decisions live in `docs/adr/` (ADRs win over the blueprint on conflict). This tree is **Phase 0
(architecture lock) + Milestone A (local devnet)** of blueprint section 32.

## Prerequisites

| tool | minimum | notes |
|---|---|---|
| Docker | 24 | this machine uses Colima: `colima start --cpu 6 --memory 12` |
| Docker Compose | 2.19 | `brew install docker-compose` + symlink into `~/.docker/cli-plugins` |
| Node.js | 22 | `.nvmrc` |
| pnpm | 9 | `corepack enable` |
| Foundry | any 1.x | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| GNU make | 3.81 | macOS default is fine |

Docker needs **8 GB RAM** and **~30 GB disk** for the devnet (dev prover; the real prover image is
amd64-only and is not run locally, see ADR-0005).

## First run

```sh
make doctor            # checks every tool above and prints the fix for anything missing
make bootstrap         # pnpm install + forge-std + sparse clone of the pinned Lineth commit
make devnet-up         # local L1 (Besu+Teku) + L2 (Maru+Besu) + coordinator + dev prover; waits for both RPCs
make devnet-status     # chain IDs, block heights, service table
make services-up       # Postgres 16 (:5439) + Redis 7 (:6389) for the ledger
make ledger-migrate    # applies services/ledger/migrations/*.sql
make test              # vitest across packages + forge test
```

`make help` lists everything. Devnet RPCs: L1 `http://localhost:8445` (chain 31648428), L2 sequencer
`http://localhost:8645` (chain 1337, `linea_*` namespace), L2 follower `:8745`. Stop with
`make devnet-down` (containers stopped, state kept; `make devnet-up` resumes the same chain) or
`make devnet-reset` (wipes volumes; required after a chain-ID change).

## Repository map

| path | what is there | status |
|---|---|---|
| `chain/lineth/` | pinned upstream commit, sparse-clone paths, `devnet.env`, chain-ID procedure | done |
| `chain/scripts/` | `doctor`, `bootstrap`, `preflight`, `up`, `status`, `logs`, `down`, `reset` | done |
| `packages/types/` | `@settlement/types`: intent, quote, settlement receipt (zod + generated JSON Schema) | done |
| `packages/config/` | `@settlement/config`: chain registry with chain-scoped decimals, CCTP domains, Circle/Bridge endpoints, env loader | done |
| `integrations/circle/{cctp,gateway,arc}/` | interfaces + in-memory mocks + tests | interfaces only |
| `integrations/fiat/` | `FiatProvider` interface + mock; Bridge mapping | interfaces only |
| `protocol/contracts/` | Foundry project; `NetworkVersion` placeholder + test + deploy script | placeholder |
| `services/ledger/` | schema v1 (every blueprint section 27 entity), `ledger_post()`, migrate/smoke scripts | done |
| `infra/docker/`, `infra/ci/`, `.github/workflows/ci.yml` | services compose; CI jobs `ts`, `contracts`, `schema`, `name-check` | done |
| `docs/architecture/`, `docs/adr/`, `docs/api/` | blueprint, 25 ADRs (10 accepted, 15 proposed), API conventions | done |
| `security/threat-model/` | threat table with mitigation status | done |

Reserved by blueprint section 25 and created when populated: `chain/{genesis,l1-contracts,prover}`,
`protocol/contracts/{amm,stableswap,router,rfq,settlement,accounts,paymaster,governance}`,
`integrations/{circle/wallets,circle/paymaster,oracles,custody}`, `services/{api,auth,accounts,
intent-engine,router,quote-engine,execution,indexer,reconciliation,risk,notifications,webhooks}`,
`apps/*`, `packages/{sdk,ui,contracts-abi,crypto}`, `infra/{terraform,kubernetes,monitoring}`,
`security/{invariants,runbooks,audits}`.

## Conventions

- TypeScript: strict, ESM, `NodeNext`; Biome for lint and format (`make lint`, `make lint-fix`);
  Vitest. Amounts are base-unit strings with a chain; decimals come from the registry.
- Solidity: Foundry, `forge fmt`, tests required next to every contract.
- SQL: plain migrations, append-only ledger, idempotency keys on every financial write.
- Every change to contracts, adapters or auth updates `security/threat-model/README.md` or says why not.
- License: not decided yet (`"license": "UNLICENSED"`); decide before anything is published.
