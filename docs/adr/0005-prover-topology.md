# ADR-0005: Prover topology and hardware sizing

- **Status:** Accepted
- **Date:** 2026-09-16
- **Blueprint refs:** sections 3, 24, 38.5

## Context
The Lineth prover image is `linux/amd64` only. In the quickstart, `PROVER_DEV_OVERRIDE=true` (dev mode) returns dummy proofs and needs ~8 GB of Docker RAM; partial-proof mode needs 30–32 GB (128 GB recommended) and a real partial proof takes ~30 min on Apple Silicon under Rosetta versus 5–10 min on x86_64. `docker/config/prover/v3/prover-config.toml` sets `prover_mode = "dev"` for execution, data availability, invalidity and aggregation.

## Decision
- Local devnet: **dev prover always** (`WIZARD_PROVER=dev`, `PROVER_DEV_OVERRIDE=true` in `chain/lineth/devnet.env`; `preflight.sh` refuses anything else on arm64).
- Shared devnet/staging: real proving on x86_64 hosts sized per upstream guidance; that is where proof latency (section 37) is measured.
- Production prover fleet sizing is decided with the shared devnet numbers, not guessed now.

## Consequences
Nothing proven locally is a real proof; the local `L1 finality` states in receipts are exercised for plumbing only. Milestone B ("prove") is only complete on the shared devnet.

## Verification
`make devnet-preflight` fails on arm64 unless `PROVER_DEV_OVERRIDE=true`.
