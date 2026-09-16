# ADR-0002: Ethereum settlement strategy and chain identity

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 3, 24, 38.2

## Context
The Lineth quickstart supports two L1 modes: a self-contained local Besu+Teku L1 (chain ID `31648428`, host RPC `:8445`) and Sepolia (needs a funded deployer, 2–3 ETH). The L2 chain ID `1337` is baked into three upstream files that must agree (`docker/config/l2-genesis-initialization/genesis-besu.json.template`, `genesis-maru.json.template`, `docker/config/prover/v3/prover-config.toml`); changing it requires wiping volumes. Host ports: L2 sequencer RPC `:8645` (LINEA namespace), L2 follower `:8745`/WS `:8746`, coordinator Postgres `:5432`.

## Decision
| environment | L1 | L2 chain ID |
|---|---|---|
| local devnet (`make devnet-up`) | local L1, chain `31648428` | `1337` (**temporary**) |
| shared devnet / staging | Sepolia | to be chosen with the production ID |
| production | Ethereum mainnet | to be chosen and registered in `ethereum-lists/chains` before any public testnet |

- `packages/config` `l2-devnet` entry and `chain/lineth/devnet.env` are the only places our code writes the devnet IDs; services read them from there.
- Our own Postgres/Redis bind `:5439`/`:6389` so they never collide with the quickstart's `:5432`.

## Consequences
- The production chain ID decision is open and blocks nothing until the shared devnet. It must be made once, because every signed message domain (EIP-712, intents, RFQ) embeds it.
- Anyone changing the devnet ID must follow `chain/lineth/README.md` and run `make devnet-reset`.

## Verification
`chain/scripts/bootstrap.sh` cross-checks the three upstream files against `L2_CHAIN_ID`; `make devnet-status` fails unless `eth_chainId` on `:8445` and `:8645` return the configured values.
