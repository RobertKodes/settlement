# ADR-0001: Lineth version and upstream strategy

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 3, 35, 38.1

## Context
Lineth is the Linea stack donated to Linux Foundation Decentralized Trust (announced 2026-05-05). Verified 2026-09-16: canonical repository `https://github.com/LFDT-Lineth/lineth-monorepo` (Apache-2.0 + MIT; `Consensys/linea-monorepo` redirects there), `main` at `f58edf55cf74a15d05ed3236991d8debb39247d0`, component releases `releases/linea-besu-package/v2.2.0`, `releases/maru/v1.3.0`, `releases/coordinator/v1.2.0-rc1`. The monorepo is multi-GB; the local devnet only needs `contracts/`, `docker/`, `scripts/` and `docs/getting-started/lineth-stack/` (images come from registries).

## Decision
- Run the upstream stack **unmodified**. No private fork: changes we need go upstream first (blueprint section 35).
- Pin the exact commit in `chain/lineth/UPSTREAM_COMMIT`; vendor it with a sparse, shallow, detached checkout into the gitignored `chain/lineth/upstream/` (`make devnet-bootstrap`). Not a submodule: a submodule would put the whole monorepo into every clone and CI checkout.
- Bumps are deliberate: new SHA + a dated note in this ADR + `make devnet-reset` + re-verify the `start.sh` flags `chain/scripts/up.sh` relies on.

## Local overlay
Two pnpm-11 policy settings are appended to the vendored `pnpm-workspace.yaml` by `chain/scripts/lib.sh`
(`apply_upstream_overlay`) because the pinned commit's own quickstart cannot install otherwise; details in
`chain/lineth/README.md`. This is the only modification to the vendored tree and it is re-applied on bootstrap.

## Consequences
- Devnet behaviour is reproducible from one SHA; "works on my machine" differences reduce to Docker resources.
- We inherit upstream's release cadence; we track its security advisories and the `docs/getting-started/lineth-stack/AGENTS.md` procedure.
- A production deployment will pin *release tags* per component instead of one monorepo SHA; that is a Phase 1 follow-up.

## Verification
`make devnet-bootstrap` fails unless `git rev-parse HEAD` in `upstream/` equals the pin.

## References
- https://www.lfdecentralizedtrust.org/projects/lineth
- https://github.com/LFDT-Lineth/lineth-monorepo
