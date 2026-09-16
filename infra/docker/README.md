# infra/docker

- `compose.services.yml` — Postgres 16 + Redis 7 for the ledger and services (`make services-up`).
- The chain itself is not here: `make devnet-up` runs the upstream Lineth quickstart from
  `chain/lineth/upstream/docs/getting-started/lineth-stack/docker-compose.yml`.

Reserved (blueprint section 24): Terraform under `infra/terraform/`, Kubernetes under
`infra/kubernetes/`, Prometheus/Grafana under `infra/monitoring/` — created when populated.
