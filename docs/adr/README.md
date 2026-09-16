# Architecture decision records

One decision per file, numbered, never deleted: a reversed decision gets a new ADR that supersedes the
old one. Template: `0000-template.md`. New: `make adr-new NAME="short title"`. The 25 initial records
are the decisions blueprint section 38 says must be made before heavy coding.

| # | title | status |
|---|---|---|
| [0001](0001-lineth-version-and-upstream-strategy.md) | Lineth version and upstream strategy | Accepted |
| [0002](0002-settlement-and-chain-identity.md) | Ethereum settlement strategy and chain identity | Accepted |
| [0003](0003-data-availability.md) | Data availability configuration | Proposed |
| [0004](0004-sequencer-operator-topology.md) | Sequencer and operator topology | Proposed |
| [0005](0005-prover-topology.md) | Prover topology and hardware sizing | Accepted |
| [0006](0006-fee-and-gas-model.md) | Fee and gas model | Proposed |
| [0007](0007-canonical-usdc-representation.md) | Canonical USDC representation before Circle native support | Accepted (local devnet) |
| [0008](0008-smart-account-standard.md) | Smart-account standard | Accepted |
| [0009](0009-upgradeability-strategy.md) | Upgradeability strategy | Proposed |
| [0010](0010-dex-architecture.md) | DEX architecture: custom vs proven components | Proposed |
| [0011](0011-stableswap-invariant.md) | StableSwap invariant | Proposed |
| [0012](0012-concentrated-liquidity-design.md) | Concentrated-liquidity design | Proposed |
| [0013](0013-rfq-signature-and-settlement.md) | RFQ signature and settlement standard | Proposed |
| [0014](0014-intent-format.md) | Intent format v1 | Accepted |
| [0015](0015-internal-ledger-architecture.md) | Internal ledger architecture | Accepted |
| [0016](0016-indexer-architecture.md) | Indexer architecture | Proposed |
| [0017](0017-cross-chain-abstraction.md) | Cross-chain abstraction: CCTP V2 and Gateway | Accepted |
| [0018](0018-arc-adapter-design.md) | Arc adapter design | Accepted |
| [0019](0019-fiat-provider-abstraction.md) | Fiat-provider abstraction | Accepted |
| [0020](0020-oracle-providers.md) | Oracle providers and fallback rules | Proposed |
| [0021](0021-key-management.md) | Key management: MPC, HSM, hot/warm/cold | Proposed |
| [0022](0022-governance-security-council.md) | Governance and security council | Proposed |
| [0023](0023-monitoring-stack.md) | Monitoring stack | Proposed |
| [0024](0024-api-versioning-and-idempotency.md) | API versioning and idempotency rules | Accepted |
| [0025](0025-compliance-boundary.md) | Compliance boundary between protocol and hosted services | Proposed |
