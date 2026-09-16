# chain/lineth — vendored Lineth stack

The local devnet runs the upstream Lineth quickstart unchanged. Nothing under `upstream/` is committed:
`make devnet-bootstrap` sparse-clones the commit in `UPSTREAM_COMMIT` (paths in `UPSTREAM_SPARSE_PATHS`)
into `upstream/`, which is gitignored. Images are pulled from the registries the quickstart pins in its
`versions.env`.

| file | purpose |
|---|---|
| `UPSTREAM_COMMIT` | the exact `LFDT-Lineth/lineth-monorepo` commit we run (ADR-0001) |
| `UPSTREAM_SPARSE_PATHS` | which upstream directories are needed and why |
| `devnet.env` | our overrides for the quickstart `.env` (local L1, chain IDs, dev prover) |
| `upstream/` | the sparse checkout, a real git repo because `start.sh` uses `git` for repo-root discovery |

## Known upstream quirks at the pinned commit

1. `scripts/phases/01-generate-accounts.sh` runs `pnpm install --filter linea-monorepo …` but the root
   package is now `lineth-monorepo`; the filter matches nothing (harmless warning, the `contracts...`
   filter still installs what the step needs).
2. pnpm 11.9 (pinned by `packageManager`) refuses the git-sourced sub-dependency of
   `@chainlink/contracts` (`blockExoticSubdeps`) and `pnpm exec` triggers a full reinstall first
   (`verifyDepsBeforeRun`), so the account-setup container dies silently. `apply_upstream_overlay` in
   `chain/scripts/lib.sh` appends `blockExoticSubdeps: false` and `verifyDepsBeforeRun: false` to the
   vendored `pnpm-workspace.yaml` (pnpm 11 ignores `.npmrc` for these). Both are worth an upstream issue.

## Contracts on the devnet

`make devnet-deploy` runs `protocol/contracts/script/DeployDevnet.s.sol` with the quickstart's generated L2
deployer key (`artifacts/accounts/runtime-keys.env`, funded in the L2 genesis) and writes the addresses to
`chain/lineth/deployments.local.json` (gitignored: they change on every reset). `make devnet-status` shows
them next to the L1 finality line (`currentL2BlockNumber()` on the `LinethRollupV8` proxy the quickstart
deployed, address in `artifacts/deployments/addresses.json` under `l1`).

## Stop, resume, reset

- `make devnet-down` = `docker compose stop` (containers and volumes kept) and records the running services
  in `chain/lineth/.resume-services`.
- `make devnet-up` resumes those containers with `docker compose start` when they still exist, so the chain
  continues from where it stopped. Otherwise (first boot, after `make devnet-reset`, or `DEVNET_FRESH=1`)
  it runs the upstream wizard + `start.sh`, which **always re-genesises**: upstream's `start.sh` treats
  every run as a cold start and its port check is a plain listener test, so a partially running stack is
  stopped first.
- `make devnet-reset` = `docker compose down -v` + upstream `reset.sh`: wipes chain data, artifacts and `.env`.

## Bumping the upstream commit

1. Put the new SHA in `UPSTREAM_COMMIT` and record it in a new revision of ADR-0001.
2. `make devnet-reset && rm -rf chain/lineth/upstream && make devnet-bootstrap`.
3. Re-check that the `start.sh` flags used by `chain/scripts/up.sh` still exist (`grep -- '--l1-mode' upstream/docs/getting-started/lineth-stack/scripts/start.sh`).
4. `make devnet-up && make devnet-status`.

## Changing the L2 chain ID

The ID must agree in three upstream files, otherwise the prover's public inputs and the genesis disagree
and nothing finalizes:

- `upstream/docker/config/l2-genesis-initialization/genesis-besu.json.template`
- `upstream/docker/config/l2-genesis-initialization/genesis-maru.json.template`
- `upstream/docker/config/prover/v3/prover-config.toml` (`[layer2] chain_id`)

plus `L2_CHAIN_ID` in `devnet.env` and the `l2-devnet` entry in `packages/config/src/chains.ts`.
Then `make devnet-reset` (volumes must be wiped). The quickstart renders its own genesis from the
templates via `scripts/services/render-l2-genesis.sh`, so edit the templates, not the rendered output.

## Ports (host)

| service | port |
|---|---|
| L1 execution RPC | 8445 |
| L2 sequencer RPC (LINEA namespace) | 8645 |
| L2 follower node RPC / WS | 8745 / 8746 |
| coordinator / Postgres | 9545 / 5432 |
| L2 Blockscout | 4000 (API), 4001 (UI) |

The full `HOST_PORT_*` list is in the quickstart `.env.example`; overrides go there. Live links are printed by `make devnet-status` from the quickstart's
own `scripts/links.sh`.
