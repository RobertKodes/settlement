# infra/ci

GitHub Actions requires workflows under `.github/workflows/`, so the pipeline lives at
`.github/workflows/ci.yml`; this directory holds the documentation.

| job | what |
|---|---|
| `ts` | `pnpm install --frozen-lockfile`, Biome, `turbo typecheck test build` (Node 22) |
| `contracts` | `forge fmt --check`, `forge build`, `forge test` (foundry-toolchain, stable) |
| `schema` | applies `services/ledger/migrations/*.sql` to a Postgres 16 service, then a smoke `ledger_post` |
| `name-check` | fails if the dropped working name reappears |

The devnet is not booted in CI (needs 8 GB Docker RAM and ~30 GB of images). A `workflow_dispatch`
job for a self-hosted runner is the planned follow-up.
