# ADR-0023: Monitoring stack

- **Status:** Proposed
- **Date:** 2026-09-16
- **Blueprint refs:** sections 20, 24, 38.23

## Context
Section 20 defines chain, protocol, Circle, fiat and security dashboards. The Lineth quickstart ships Blockscout and a `compose-spec-extra-observability.yml` upstream.

## Decision (leaning)
OpenTelemetry in every service, Prometheus + Grafana + Alertmanager, centralised structured logs (Loki), on-call integration. `NetworkVersion.VERSION` and `make devnet-status` are the first probes; dashboards are added per phase with alerts defined in the same PR (section 34).
