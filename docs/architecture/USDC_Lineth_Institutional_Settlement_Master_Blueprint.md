# USDC-Native Lineth ZK Institutional Settlement Network
## Master Product, Protocol, Infrastructure & Development Blueprint

**Status:** End-state architecture / development source of truth  
**Date:** 2026-09-16  
**Working name:** none yet. The placeholder used in the original draft was dropped on 2026-09-16; this text says "the network". Code uses the neutral scope `@settlement/*` and the chain key `l2-devnet` until a brand exists.

---

## 0. Executive definition

The network is a **USDC-native, Lineth-powered ZK rollup purpose-built as a highly coordinated institutional settlement layer**, unifying fiat, USDC, ERC-20 assets, EVM applications, cross-chain liquidity and programmable accounts behind one account and one intent/settlement interface.

The core hierarchy is:

> **Account -> Intent -> Coordination -> Execution -> Settlement -> Proof**

The product is **not primarily a DEX**. The DEX is one execution venue inside a larger settlement network.

### Core technology roles

| Component | Role |
|---|---|
| **Lineth** | Our EVM-equivalent ZK rollup stack and execution network |
| **Ethereum** | ZK proof verification / L1 settlement anchor |
| **USDC** | Primary monetary, settlement and accounting asset |
| **Arc** | Circle-native stablecoin coordination / institutional financial hub |
| **CCTP** | Canonical native USDC movement across supported chains |
| **Gateway** | Unified USDC liquidity/balance abstraction across supported chains |
| **Circle Wallets / smart accounts** | User/account UX and programmable authorization where appropriate |
| **Paymaster / gas abstraction** | USDC-denominated or sponsored transaction fees where supported |
| **ERC-20** | Common tokenized asset interface |
| **EVM** | Smart-contract execution environment |
| **Fiat provider(s)** | Regulated bank/fiat on-ramp and off-ramp edge |
| **Native DEX** | Permissionless liquidity and price execution venue |
| **Intent Router** | Coordinates liquidity, chain, FX, gas and settlement path |

**Important terminology:** the rollup should be described as **USDC-native**, not “USDC-backed,” unless USDC is literally used as economic/security collateral. USDC is the base money/settlement asset; Lineth + Ethereum provide the rollup execution/proof architecture.

---

# 1. Product thesis

Today's financial stack is fragmented across bank accounts, chains, wallets, stablecoins, bridges, gas tokens, exchanges and settlement venues. The user or institution is forced to understand the infrastructure.

The network reverses that relationship.

A user should be able to express:

- “Send €5 million to Counterparty B.”
- “Convert 2 million USDC to EURC at best execution.”
- “Settle tokenized treasury assets against USDC atomically.”
- “Move my USDC from another supported chain and deploy it here.”
- “Pay this invoice from whatever balance I have.”

The system determines:

1. available balances;
2. authorization and policy;
3. liquidity source;
4. chain/location of funds;
5. cross-chain path;
6. execution venue;
7. FX route;
8. gas strategy;
9. settlement transaction(s);
10. proof/finality state;
11. accounting/reconciliation output.

The blockchain becomes infrastructure rather than the user experience.

---

# 2. End-state architecture

```text
                              USERS / INSTITUTIONS
                                      |
                +---------------------+---------------------+
                |                     |                     |
             Consumer              Business           Institutional
                |                     |                     |
                +---------------------+---------------------+
                                      |
                              UNIFIED ACCOUNT
                                      |
                               INTENT ENGINE
                                      |
                              POLICY / RISK LAYER
                                      |
                                SMART ROUTER
                                      |
       +------------------------------+------------------------------+
       |                              |                              |
       v                              v                              v
 THE NETWORK / LINETH                    ARC                        OTHER CHAINS
 Permissionless                Circle financial             Ethereum/Base/
 execution layer               coordination hub             Linea/etc.
       |                              |                              |
 +-----+------+                 +-----+------+                       |
 | DEX        |                 | USDC/EURC  |                       |
 | Payments   |                 | StableFX   |                       |
 | DeFi       |                 | Circle     |                       |
 | ERC-20/RWA |                 | ecosystem  |                       |
 +-----+------+                 +-----+------+                       |
       |                              |                              |
       +----------------------+-------+------------------------------+
                              |
                       CCTP / GATEWAY
                              |
                             USDC
                              |
                    REGULATED FIAT EDGE
                              |
                       BANKING SYSTEM

THE NETWORK / LINETH
      |
      | ZK validity proof + data/finalization pipeline
      v
   ETHEREUM
```

---

# 3. Lineth: network foundation

Lineth is the open-source, production-grade, EVM-equivalent ZK rollup stack derived from the Linea Stack and hosted under Linux Foundation Decentralized Trust.

Current Lineth architecture includes:

- **Besu execution** with L2-specific plugins;
- **Maru** consensus/block production;
- sequencer functionality;
- coordinator/finalization pipeline;
- ZK prover;
- L1 contracts;
- EIP-4844 blob publication configuration;
- Ethereum JSON-RPC compatibility plus L2-specific RPC namespaces;
- architecture designed to evolve toward multi-operator sequencing.

### What we own/configure

- chain identity and genesis;
- chain ID and network parameters;
- sequencing policy;
- fee/gas policy;
- block timing/configuration;
- RPC infrastructure;
- prover infrastructure;
- L1 settlement configuration;
- upgrade/governance process;
- bridge/messaging integrations;
- account abstraction support;
- observability;
- network-level transaction policies that do not violate the permissionless product objective.

### Network objective

The end-state network should support:

- permissionless smart-contract deployment;
- EVM/Solidity tooling;
- low and predictable fees;
- fast soft finality with ZK-backed Ethereum finalization;
- multiple RPC operators;
- multiple sequencer/operator roadmap;
- resilient proving;
- transparent network health;
- open explorer/indexing;
- third-party developer ecosystem.

---

# 4. Circle / USDC monetary layer

USDC is the primary settlement and accounting asset.

Do **not** launch a proprietary stablecoin simply to have a native token. Native Circle-issued USDC on the new network is a strategic integration objective, not something automatically inherited from Lineth/Linea.

### Circle products to design around

#### USDC
Primary dollar settlement asset.

#### CCTP
Canonical cross-chain native USDC transfer through burn/mint on supported chains. Build against the current canonical CCTP generation, not deprecated legacy integrations.

#### Gateway
Unified USDC balance/liquidity abstraction across supported chains. Useful for avoiding fragmented per-chain working capital and enabling chain-abstracted user flows.

#### Paymaster
USDC gas-payment abstraction on supported networks. On the network, implement an equivalent native/account-abstraction strategy until/if Circle directly supports the network.

#### Circle Wallets / smart-account ecosystem
Potential embedded wallet infrastructure and account UX. Keep the protocol compatible with external self-custody wallets and institutional custody providers.

#### Arc
Arc is not the rollup base. Arc is a separate Circle L1 optimized for stablecoin finance and should act as a **financial coordination/liquidity/settlement peer** to the network.

---

# 5. Where Arc fits

Arc and the network/Lineth should have different jobs.

### The network / Lineth

- permissionless execution;
- native DEX;
- DeFi;
- third-party applications;
- tokenized assets;
- payments;
- programmable accounts;
- settlement contracts;
- open developer ecosystem.

### Arc

- Circle-native stablecoin environment;
- USDC/EURC/other Circle ecosystem assets;
- institutional stablecoin coordination;
- Arc-native FX / RFQ capabilities where accessible;
- Circle platform integrations;
- potential source/destination for institutional liquidity.

### Router relationship

The the network router should be able to compare execution across:

1. The network native liquidity;
2. Arc-native venues/FX where integration is available;
3. supported external venues/chains.

The user requests an outcome, not a chain.

---

# 6. Unified Account: the actual product

The unified account is the primary abstraction.

It may expose:

```text
Account: institution@network

Fiat-equivalent balances / claims / connected rails
USDC
EURC
ERC-20 assets
Tokenized securities/RWAs where legally supported
DeFi positions
Liquidity positions
Cross-chain USDC availability
Pending settlement obligations
```

### Account capabilities

- passkeys;
- smart-contract wallet support;
- external wallet connection;
- ERC-1271 authorization;
- ERC-4337-style account abstraction where appropriate;
- EIP-7702 compatibility where useful;
- multisig;
- institutional roles;
- transaction limits;
- session keys;
- delegated permissions;
- whitelists/allowlists at account-policy level;
- recovery policies;
- spending policies;
- automated settlement permissions;
- API/service-account permissions;
- AI-agent subaccounts with bounded authority.

### Institutional role model

Example roles:

- Owner
- Administrator
- Trader
- Treasury operator
- Approver
- Compliance reviewer
- Auditor/read-only
- API service account
- Settlement agent

Support N-of-M approvals and policy rules such as:

```text
< $50k        -> 1 approver
$50k-$1m      -> 2 approvers
> $1m         -> treasury + risk approval
new recipient -> mandatory secondary approval
```

---

# 7. Intent Engine

The intent engine converts a desired financial outcome into executable operations.

### Example intent

```json
{
  "action": "settle",
  "source": {"asset": "USDC", "amount": "5000000"},
  "destination": {"asset": "EURC", "recipient": "institution-b"},
  "constraints": {
    "maxSlippageBps": 5,
    "deadline": "2026-09-16T18:30:00Z",
    "requireAtomicity": true,
    "allowedVenues": ["native", "arc"]
  }
}
```

### Intent lifecycle

```text
CREATED
  -> AUTHORIZED
  -> QUOTED
  -> POLICY_CHECKED
  -> ROUTE_LOCKED
  -> EXECUTING
  -> SETTLED
  -> PROVEN / FINALIZED
  -> RECONCILED
```

Failure states must be explicit and machine-readable.

---

# 8. Smart Router / Coordination Engine

This is a core defensible component.

### Inputs

- balances;
- Gateway balance where supported;
- CCTP availability;
- native chain balances;
- The network AMM quotes;
- stable-pool quotes;
- RFQ quotes;
- Arc venue quotes;
- external venue quotes;
- gas/fees;
- expected settlement time;
- slippage;
- liquidity depth;
- policy constraints;
- jurisdiction/product constraints at regulated edges;
- counterparty requirements.

### Optimization objective

Do not optimize only for nominal price.

Calculate an **all-in execution score** using:

- output amount;
- network fees;
- cross-chain fees;
- expected slippage;
- latency;
- settlement certainty;
- venue availability;
- policy compatibility;
- capital movement required;
- failure/retry cost.

### Router modules

```text
router/
  quote-engine
  pathfinder
  venue-adapters
  cctp-adapter
  gateway-adapter
  arc-adapter
  native-dex-adapter
  external-dex-adapters
  gas-estimator
  policy-engine
  simulation-engine
  execution-engine
  reconciliation-engine
```

---

# 9. Native DEX and liquidity engine

The DEX is the native permissionless execution venue.

### V1/V2 mechanisms in the end-state design

#### StableSwap
Optimized for correlated/stable assets such as USDC/EURC and other approved stablecoin pairs.

#### Concentrated-liquidity AMM
For volatile pairs such as ETH/USDC and other ERC-20/USDC markets.

#### RFQ
For institutional size, professional market makers and deterministic quotes.

#### Order functionality
Later support for limit orders / solver or order-book style execution if it materially improves institutional execution.

### Core contracts

```text
protocol/contracts/
  PoolFactory.sol
  StablePool.sol
  ConcentratedPool.sol
  Router.sol
  Quoter.sol
  PositionManager.sol
  FeeController.sol
  OracleAdapter.sol
  RFQSettlement.sol
  IntentSettlement.sol
  Permit/Signature modules
  EmergencyControls.sol
```

### Required DEX protections

- deadline;
- min amount out;
- max slippage;
- replay protection;
- signature domain separation;
- oracle manipulation resistance;
- reentrancy protection;
- fee bounds;
- token-behavior validation;
- pool invariant testing;
- sandwich/MEV mitigation research;
- circuit breakers only where justified and transparently governed.

---

# 10. Institutional settlement primitives

This is where the network differentiates from a retail DEX.

### Delivery-versus-payment (DvP)

Atomic asset-versus-USDC settlement.

```text
Institution A                       Institution B
    USDC                            Tokenized Asset
      |                                   |
      +---------------+-------------------+
                      |
                DvP Contract
                      |
              atomic settlement
                      |
        +-------------+-------------+
        |                           |
  Asset -> A                    USDC -> B
```

### Payment-versus-payment (PvP)

Stablecoin/currency settlement where both legs complete atomically or the operation reverts.

### Escrow

Programmable settlement based on contractual conditions.

### Batch settlement

Aggregate multiple obligations and settle net positions when legally/product-appropriate.

### Scheduled settlement

Future-date settlement with explicit authorization and cancellation rules.

### Settlement receipts

Every completed operation should produce machine-readable evidence containing:

- intent ID;
- execution route;
- tx hashes;
- assets/amounts;
- counterparties/account IDs as appropriate;
- timestamps;
- fee breakdown;
- soft-finality state;
- L1 proof/finalization state;
- reconciliation status.

---

# 11. Fiat integration layer

Fiat is a **regulated edge**, not part of the permissionless consensus protocol.

Use providers such as Bridge or other licensed/eligible partners depending on geography, product and availability.

### Provider abstraction

Never hard-code the company into one fiat provider.

```text
FiatProvider interface
  createCustomer()
  createOnRamp()
  createOffRamp()
  createVirtualAccount()
  getQuote()
  getTransferStatus()
  webhookVerify()
  reconcile()
```

### Fiat flows

```text
Bank -> regulated provider -> USDC -> the network account
The network USDC -> regulated provider -> bank
```

### Required systems

- provider onboarding state;
- KYC/KYB state where required;
- sanctions/risk integration where required;
- transaction limits;
- beneficiary management;
- bank transfer state machine;
- webhook processing;
- idempotency;
- ledger/reconciliation;
- failed/returned transfer handling;
- customer support tooling;
- jurisdiction/product eligibility rules.

**Legal note:** “permissionless rollup” does not make fiat rails permissionless. Fiat services must follow the requirements of the applicable providers and jurisdictions.

---

# 12. Internal ledger and accounting

Do not rely on chain indexing alone for product accounting.

Build a **double-entry operational ledger** that references onchain truth without pretending the internal database is the blockchain.

### Ledger concepts

- account;
- asset;
- debit;
- credit;
- pending;
- settled;
- reversed;
- fees;
- external transfer;
- onchain transaction reference;
- reconciliation batch.

### Data stores

Recommended separation:

- PostgreSQL: product state / ledger / users / institutions / intents;
- chain indexer database: decoded onchain events;
- Redis: ephemeral locks/cache/rate limiting;
- object storage: reports, signed exports, audit artifacts;
- analytics warehouse later: execution, volume, risk and business intelligence.

All financial mutations require idempotency keys.

---

# 13. Chain indexing and data platform

Required services:

- full node(s);
- archive access where required;
- event indexer;
- block/reorg tracker;
- transaction status service;
- contract ABI registry;
- price/oracle data;
- account portfolio aggregator;
- settlement proof tracker;
- L1 finalization tracker.

### APIs

Expose stable product APIs rather than raw chain assumptions.

```text
GET  /v1/accounts/:id/balances
POST /v1/intents
GET  /v1/intents/:id
POST /v1/quotes
POST /v1/settlements
GET  /v1/settlements/:id
POST /v1/transfers
GET  /v1/transactions/:id
POST /v1/webhooks
```

Use versioning from day one.

---

# 14. Wallet, key and custody architecture

Support multiple custody modes.

### Consumer / embedded

- passkey-first smart account;
- recovery configuration;
- optional external wallet;
- no forced seed-phrase UX.

### Crypto-native

- WalletConnect-compatible wallets;
- hardware wallets;
- EOA and smart-wallet support.

### Institutional

- multisig;
- MPC/custody integrations;
- policy-controlled signing;
- HSM/KMS-backed service keys;
- transaction approval workflows.

### Key rules

- application servers must not casually store raw private keys;
- isolate hot signing infrastructure;
- HSM/KMS/MPC for privileged keys;
- rotate API/service credentials;
- hardware/offline controls for governance/treasury roots;
- documented key-compromise procedure.

---

# 15. Gas abstraction

The normal user should not need ETH simply to use a USDC-native product.

Target UX:

```text
Send:        10,000.00 USDC
Network fee:      0.04 USDC
Total:       10,000.04 USDC
```

### Strategy

- use Circle Paymaster where directly supported;
- implement network-native paymaster/gas sponsorship architecture on our Lineth chain;
- support ERC-4337 smart accounts where appropriate;
- evaluate EIP-7702 flows for EOAs;
- quote gas in user-facing stable units;
- maintain anti-abuse/rate-limit systems for sponsored gas.

---

# 16. Security model

Security is a parallel workstream from the first commit.

## Smart contracts

- minimal trusted surface;
- explicit upgradeability policy;
- timelocks;
- multisig governance;
- role separation;
- invariants;
- unit tests;
- integration tests;
- fuzzing;
- property-based tests;
- fork tests where useful;
- static analysis;
- independent audits;
- public bug bounty before major value-at-risk.

## Rollup/network

- sequencer monitoring;
- prover monitoring;
- coordinator monitoring;
- L1 submission monitoring;
- RPC redundancy;
- node diversity;
- DDoS protection;
- secret isolation;
- reproducible deployments;
- disaster recovery;
- backup/restore tests;
- network halt/recovery runbooks;
- upgrade rehearsals.

## Product/API

- WebAuthn/passkeys;
- MFA for institutions;
- session/device management;
- RBAC/ABAC;
- API key scopes;
- IP restrictions for institutional APIs where desired;
- rate limits;
- signed webhooks;
- idempotency;
- fraud/anomaly monitoring;
- withdrawal/recipient controls;
- secure audit logs.

## Treasury

- multisig/MPC;
- daily limits;
- hot/warm/cold separation;
- independent approvals;
- treasury reconciliation;
- emergency procedures.

---

# 17. Compliance architecture without corrupting the protocol

Separate **protocol permissionlessness** from **regulated product edges**.

```text
PERMISSIONLESS CORE
- Lineth network
- public RPC
- smart contracts
- DEX
- self-custody transfers
- third-party apps

REGULATED / CONTROLLED SERVICES
- fiat on/off ramps
- hosted/embedded account services where applicable
- institutional onboarding
- specific regulated assets
- jurisdiction-restricted product features
```

Do not claim that Circle, Bridge or another provider acts as broker, dealer, clearing agency or other regulated intermediary unless the applicable agreement explicitly says so.

Obtain specialist legal advice before production launch involving fiat, securities/tokenized securities, custody, exchange/brokerage-like services or institutional clearing/settlement in each target jurisdiction.

---

# 18. Privacy architecture

Institutional finance may require confidentiality while public chains require verifiability.

Design extension points for:

- encrypted offchain metadata;
- selective disclosure;
- role-gated documents;
- zero-knowledge policy proofs where justified;
- Arc opt-in privacy capabilities when applicable;
- separation of public settlement data from private business metadata.

Never place sensitive PII directly onchain.

---

# 19. Oracle architecture

Required for non-stable assets, risk controls and some settlement products.

Design:

```text
OracleRegistry
  -> primary oracle
  -> secondary/fallback oracle
  -> freshness limits
  -> deviation limits
  -> circuit-break policy
```

For DEX price data, distinguish:

- execution price;
- TWAP;
- external reference price;
- accounting price;
- risk price.

Never use a thin native pool's spot price as the sole security-critical oracle.

---

# 20. Observability / control plane

Build an internal control plane early.

### Chain dashboard

- block height/time;
- sequencer status;
- Maru status;
- Besu status;
- coordinator state;
- prover queue;
- proof latency;
- L1 submissions;
- blob costs;
- RPC latency/errors;
- node peers.

### Protocol dashboard

- TVL;
- volume;
- pool liquidity;
- spreads;
- slippage;
- failed swaps;
- router venue share;
- RFQ health;
- oracle freshness.

### Circle dashboard

- CCTP transfers;
- Gateway state;
- Arc adapter health;
- supported-chain availability;
- attestations/timeouts.

### Fiat dashboard

- pending deposits;
- pending withdrawals;
- provider errors;
- returned transfers;
- reconciliation breaks.

### Security dashboard

- privileged actions;
- large transactions;
- anomalous withdrawals;
- failed auth;
- policy overrides;
- contract alerts.

Suggested infrastructure: OpenTelemetry + Prometheus + Grafana + centralized logs + alert manager/on-call integration.

---

# 21. Developer platform

The network should be a platform, not a closed application.

### Public developer products

- RPC endpoints;
- WebSocket endpoints;
- explorer;
- faucet/test assets;
- contract registry;
- TypeScript SDK;
- React SDK;
- API SDKs;
- Wallet Kit;
- Payment Kit;
- Swap Kit;
- Intent Kit;
- webhooks;
- sandbox;
- examples;
- status page;
- documentation portal.

### Desired developer UX

```ts
await network.settle({
  from: { asset: "USDC", amount: "100000" },
  to: { asset: "EURC", recipient: "counterparty@network" },
  maxSlippageBps: 5
});
```

The SDK should handle chain, route, gas, execution and settlement state.

---

# 22. AI-agent accounts

Treat autonomous software as a first-class account type.

### Agent policies

- daily budget;
- per-transaction limit;
- allowed assets;
- allowed contracts;
- allowed recipients;
- expiry;
- human approval threshold;
- revocable session key;
- no fiat withdrawal unless explicitly authorized.

Potential uses:

- API payments;
- compute/data purchases;
- treasury automation;
- automated rebalancing;
- machine-to-machine settlement;
- recurring microtransactions.

---

# 23. Product surfaces

## Consumer

- account creation;
- portfolio;
- send/receive;
- swap;
- deposit/withdraw;
- activity;
- QR/payment links;
- contacts;
- recovery/security.

## Business

- merchant account;
- invoices;
- checkout;
- payment links;
- refunds;
- payouts;
- team roles;
- API keys;
- webhooks;
- accounting exports;
- fiat settlement where available.

## Pro trading

- advanced charting;
- limit/RFQ execution;
- market depth;
- execution reports;
- API trading;
- TWAP/algorithmic execution later.

## Institutional

- treasury;
- counterparties;
- DvP/PvP;
- approval workflows;
- settlement queue;
- audit trail;
- risk limits;
- reports;
- custody integrations;
- liquidity/RFQ API.

## Liquidity provider

- positions;
- pool creation where permitted;
- fee earnings;
- range management;
- RFQ participation;
- institutional market-maker API.

---

# 24. Infrastructure topology

## Environments

Maintain at least:

- local/dev;
- shared devnet;
- staging/testnet;
- production/mainnet.

Never share production secrets or signing roots with non-production environments.

## Cloud components

```text
Load Balancer / CDN / WAF
        |
API Gateway
        |
+-------+-----------------------------+
| Auth  | Intent | Router | Ledger    |
| Quote | Index  | Risk   | Webhooks  |
+-------+-----------------------------+
        |
Postgres / Redis / Queue / Object Store
        |
+-------+-----------------------------+
| Lineth RPC | Indexer | Circle adapters |
| Fiat adapters | Oracle adapters        |
+----------------------------------------+
```

### Chain infrastructure

- multiple Besu nodes;
- Maru/sequencer nodes;
- coordinator;
- prover workers;
- L1 Ethereum endpoints from multiple providers plus self-hosted strategy where justified;
- RPC gateway;
- explorer backend;
- indexer;
- monitoring.

### Deployment

Recommended:

- Docker for local development;
- Terraform for cloud infrastructure;
- Kubernetes when operational complexity justifies it;
- GitHub Actions or equivalent CI/CD;
- signed images/artifacts;
- immutable release tags;
- staged rollouts;
- infrastructure-as-code only for production resources.

---

# 25. Monorepo

```text
<repo>/
|
+-- chain/
|   +-- lineth/
|   +-- genesis/
|   +-- l1-contracts/
|   +-- config/
|   +-- prover/
|   +-- scripts/
|
+-- protocol/
|   +-- contracts/
|   |   +-- amm/
|   |   +-- stableswap/
|   |   +-- router/
|   |   +-- rfq/
|   |   +-- settlement/
|   |   +-- accounts/
|   |   +-- paymaster/
|   |   +-- governance/
|   +-- test/
|   +-- formal/
|
+-- integrations/
|   +-- circle/
|   |   +-- arc/
|   |   +-- cctp/
|   |   +-- gateway/
|   |   +-- wallets/
|   |   +-- paymaster/
|   +-- fiat/
|   +-- oracles/
|   +-- custody/
|
+-- services/
|   +-- api/
|   +-- auth/
|   +-- accounts/
|   +-- intent-engine/
|   +-- router/
|   +-- quote-engine/
|   +-- execution/
|   +-- ledger/
|   +-- indexer/
|   +-- reconciliation/
|   +-- risk/
|   +-- notifications/
|   +-- webhooks/
|
+-- apps/
|   +-- consumer/
|   +-- business/
|   +-- institutional/
|   +-- pro/
|   +-- liquidity/
|   +-- explorer/
|   +-- admin/
|   +-- docs/
|
+-- packages/
|   +-- sdk/
|   +-- ui/
|   +-- types/
|   +-- config/
|   +-- contracts-abi/
|   +-- crypto/
|
+-- infra/
|   +-- docker/
|   +-- terraform/
|   +-- kubernetes/
|   +-- monitoring/
|   +-- ci/
|
+-- security/
|   +-- threat-model/
|   +-- invariants/
|   +-- runbooks/
|   +-- audits/
|
+-- docs/
    +-- architecture/
    +-- adr/
    +-- protocol/
    +-- api/
    +-- operations/
    +-- compliance/
```

---

# 26. Suggested implementation stack

Use boring, auditable technology wherever possible.

### Contracts

- Solidity;
- Foundry as primary contract build/test tool;
- Slither/static analysis;
- fuzz/property testing;
- optional formal verification for critical settlement invariants.

### Backend

Recommended default: TypeScript for product/API services, with Rust/Go only where performance or systems integration justifies it.

- Node.js/TypeScript;
- Fastify/NestJS or equivalent;
- viem for EVM integration;
- PostgreSQL;
- Redis;
- durable queue (Kafka/NATS/SQS equivalent depending deployment);
- OpenTelemetry.

### Frontend

- Next.js / React / TypeScript;
- viem/wagmi for external wallet integration;
- passkey/WebAuthn stack;
- shared design system.

### Chain / infra

- Lineth stack;
- Docker;
- Terraform;
- Kubernetes later/where justified;
- Prometheus/Grafana;
- centralized logs;
- secret manager + KMS/HSM.

---

# 27. Core database domains

Minimum logical entities:

```text
User
Institution
Account
AccountMember
Role
Policy
Wallet
Address
Asset
BalanceProjection
LedgerAccount
LedgerEntry
Intent
Quote
Route
Execution
Settlement
Transaction
ChainTransaction
LiquidityPool
LiquidityPosition
RFQQuote
Counterparty
Beneficiary
FiatTransfer
ProviderCustomer
ComplianceState
WebhookEndpoint
WebhookDelivery
APIKey
Session
Device
Approval
AuditEvent
ReconciliationRun
```

Keep blockchain addresses separate from product account identities.

---

# 28. API requirements

Every write API should support:

- authentication;
- authorization;
- idempotency;
- request ID;
- deterministic error codes;
- audit event;
- versioning;
- retry-safe semantics where possible.

### Example quote response

```json
{
  "quoteId": "q_123",
  "input": {"asset": "USDC", "amount": "1000000"},
  "output": {"asset": "EURC", "amount": "842910"},
  "route": [
    {"venue": "native-stableswap", "shareBps": 6500},
    {"venue": "arc-rfq", "shareBps": 3500}
  ],
  "fees": {
    "network": "4.12",
    "execution": "18.00",
    "crosschain": "0.00"
  },
  "expiresAt": "..."
}
```

---

# 29. Threat model categories

The threat model must explicitly cover:

### Rollup
- sequencer compromise;
- coordinator compromise;
- prover failure/bug;
- L1 submission failure;
- configuration errors;
- upgrade-key compromise;
- RPC censorship/outage.

### DEX
- reentrancy;
- arithmetic/invariant failure;
- oracle manipulation;
- flash-loan attacks;
- MEV/sandwiching;
- malicious tokens;
- signature replay;
- liquidity griefing;
- RFQ signer compromise.

### Cross-chain
- wrong-domain configuration;
- replay;
- attestation failure;
- destination contract bugs;
- unsupported-chain assumptions;
- stuck state/reconciliation.

### Fiat
- webhook forgery;
- duplicate events;
- bank return/reversal;
- identity mismatch;
- provider outage;
- reconciliation mismatch.

### Accounts
- passkey compromise;
- session theft;
- recovery abuse;
- privilege escalation;
- malicious delegate;
- API key leakage.

### Operations
- CI compromise;
- dependency compromise;
- secret leakage;
- insider risk;
- DNS/domain compromise;
- deployment mismatch.

---

# 30. Governance and upgrade model

Do not leave governance undefined.

### Early stage

- security council multisig;
- explicit signer identities/roles internally;
- timelocked non-emergency upgrades;
- public upgrade notices;
- emergency path with narrow scope;
- postmortem requirement after emergency action.

### Long-term

Evaluate:

- distributed sequencer/operator set;
- decentralized governance only when it improves credible neutrality;
- protocol parameter governance;
- immutable core contracts where practical;
- independent infrastructure operators.

Do **not** issue a token merely because governance needs a name. Token economics should be justified by actual network requirements.

---

# 31. Revenue model

Potential revenue sources:

- DEX protocol fee;
- routing/execution fee;
- institutional RFQ/settlement services;
- business payment fees;
- API/infrastructure plans;
- premium institutional reporting;
- sequencer/network economics;
- fiat partner economics where contractually/legal permitted;
- developer enterprise plans.

All user-facing execution costs must be transparent.

---

# 32. Build phases - end-state-first, fast execution

The phases are not disposable MVPs. Each phase must land production-quality components that fit the final architecture.

## Phase 0 - Architecture lock (2-4 days)

Deliver:

- architecture decision records;
- Lineth network configuration;
- chain IDs/environments;
- account model;
- USDC representation strategy;
- smart-contract boundaries;
- router interfaces;
- Arc/Circle adapters;
- fiat-provider abstraction;
- DB schema v1;
- API conventions;
- security model;
- governance/upgrades model;
- monorepo/bootstrap CI.

## Phase 1 - Lineth network (about 1 week target)

Deliver:

- local + shared devnet;
- Besu;
- Maru;
- sequencer;
- coordinator;
- prover;
- Ethereum testnet settlement;
- RPC;
- faucet;
- explorer;
- monitoring;
- deployment automation.

## Phase 2 - Accounts + money layer (about 1 week target)

Deliver:

- test USDC representation;
- account contracts;
- passkey/smart-account flow;
- external wallet flow;
- transfers;
- USDC-denominated gas UX;
- indexer;
- ledger;
- account APIs.

## Phase 3 - Native liquidity (1-2 weeks target)

Deliver:

- stable pool;
- concentrated-liquidity pool or proven integration/fork strategy;
- router;
- quoter;
- LP manager;
- oracle layer;
- USDC/EURC test market;
- ETH/USDC test market;
- DEX UI;
- liquidity UI;
- invariant/fuzz suite.

## Phase 4 - Arc integration (about 1 week target)

Deliver:

- Arc adapter;
- Arc account/wallet connectivity;
- Circle asset mapping;
- Arc quote/venue integration where APIs/contracts permit;
- route comparison;
- settlement state tracking;
- Arc integration tests.

## Phase 5 - CCTP + Gateway (1-2 weeks target)

Deliver:

- CCTP adapter on currently supported networks;
- Gateway adapter;
- unified balance view;
- cross-chain intent route;
- fee/time estimation;
- Hooks where useful;
- failure/recovery/reconciliation paths.

**Note:** the network itself cannot be assumed to have native USDC/CCTP/Gateway support until Circle supports the new chain. Keep interfaces ready and use supported networks during integration development.

## Phase 6 - Institutional settlement (1-2 weeks target)

Deliver:

- DvP contract;
- PvP contract;
- escrow;
- approval policies;
- counterparty registry at product layer;
- settlement receipts;
- reconciliation;
- institutional dashboard.

## Phase 7 - Consumer/business UX (about 2 weeks target)

Deliver:

- signup/passkeys;
- balances;
- send/receive;
- swap;
- activity;
- payment links;
- QR;
- merchant accounts;
- invoices;
- refunds;
- teams;
- webhooks/API keys.

## Phase 8 - Fiat rails (parallel legal + 1-2 weeks technical per provider)

Deliver:

- fiat provider adapter;
- onboarding state;
- bank deposit;
- bank withdrawal;
- webhook ingestion;
- reconciliation;
- limits/eligibility;
- operations dashboard.

## Phase 9 - Professional liquidity / RFQ

Deliver:

- RFQ protocol;
- maker API;
- signed quotes;
- quote expiry;
- settlement guarantees;
- institutional execution reports;
- TWAP/large-order routing where justified.

## Phase 10 - Public ecosystem

Deliver:

- public RPC;
- SDK;
- docs;
- faucet;
- explorer;
- status page;
- contract registry;
- developer examples;
- ecosystem onboarding;
- decentralization/operator roadmap.

---

# 33. Parallel workstreams

To move fast, do not execute phases as one serial queue. Run parallel lanes.

```text
LANE A: Lineth / chain / prover / L1
LANE B: Solidity / DEX / settlement
LANE C: Circle / Arc / CCTP / Gateway
LANE D: Accounts / auth / wallet / gas abstraction
LANE E: Backend / ledger / router / indexer
LANE F: Frontend / institutional UI / consumer UI
LANE G: Security / threat model / testing / audits
LANE H: Fiat / legal / compliance / partnerships
LANE I: DevOps / observability / CI/CD
LANE J: Docs / SDK / developer ecosystem
```

Integrate continuously against shared interfaces and contract schemas.

---

# 34. Definition of done for every component

A feature is not done when “it works on my machine.”

Required where applicable:

- code reviewed;
- unit tests;
- integration tests;
- negative tests;
- fuzz/property tests for contracts;
- API schema documented;
- metrics emitted;
- logs structured;
- alerts defined;
- threat model updated;
- runbook written;
- deployment automated;
- rollback/recovery path defined;
- user-facing error states handled;
- reconciliation behavior defined.

---

# 35. Critical external dependencies / partnership milestones

### Circle

Target:

- native USDC support on the network;
- CCTP support;
- Gateway support;
- Paymaster/support strategy;
- Circle Wallets compatibility;
- Arc integration;
- technical partnership/grant/ecosystem relationship.

### Lineth / LFDT ecosystem

Target:

- upstream contribution relationship;
- production deployment guidance;
- security/upgrade awareness;
- avoid maintaining unnecessary private forks.

### Fiat provider(s)

Target:

- eligible jurisdictions;
- institutional/customer onboarding model;
- bank rails;
- virtual accounts where useful;
- USDC settlement;
- webhook/reconciliation SLA.

### Infrastructure

Target:

- Ethereum L1 redundancy;
- cloud/provider redundancy strategy;
- custody/MPC providers for institutions;
- oracle providers;
- independent auditors.

---

# 36. What NOT to do

1. **Do not create a new stablecoin** just for branding.
2. **Do not call the network USDC-backed** unless that is economically true.
3. **Do not assume a new Lineth chain automatically gets Circle-issued native USDC, CCTP, Gateway or Paymaster.**
4. **Do not make Arc and Lineth perform the same role.**
5. **Do not fork a DEX and call the product finished.**
6. **Do not put fiat/KYC logic into the permissionless consensus layer unnecessarily.**
7. **Do not store PII onchain.**
8. **Do not rely on a single RPC, sequencer machine, prover or cloud account.**
9. **Do not treat chain event indexing as an accounting ledger.**
10. **Do not launch an unnecessary governance token early.**
11. **Do not make the normal user manage gas tokens.**
12. **Do not optimize the router only for headline exchange rate; use all-in execution.**
13. **Do not ship institutional settlement without reconciliation, audit logs and approval policies.**
14. **Do not treat smart-contract audits as a substitute for operational security.**
15. **Do not tightly couple core product APIs to one third-party provider.**

---

# 37. Success metrics

### Network

- uptime;
- block latency;
- proof latency;
- L1 finalization latency;
- failed transaction rate;
- RPC latency;
- cost per settlement.

### Liquidity

- TVL;
- volume;
- spread;
- slippage at $10k/$100k/$1m/$10m;
- route success rate;
- capital efficiency;
- LP retention.

### Settlement

- settlement success rate;
- time-to-soft-finality;
- time-to-L1-finality;
- reconciliation break rate;
- failed/retried settlement rate.

### Product

- funded accounts;
- active institutions;
- monthly settlement volume;
- payment volume;
- API volume;
- cross-chain volume;
- fiat in/out volume where available.

### Developer ecosystem

- deployed contracts;
- active apps;
- SDK usage;
- third-party RPC traffic;
- developer retention.

---

# 38. Initial technical decisions that must be made before coding heavily

Create ADRs for each:

1. Lineth version/commit and upstream strategy.
2. Ethereum testnet/mainnet settlement strategy.
3. Data availability configuration.
4. Sequencer/operator topology.
5. Prover topology and hardware sizing.
6. Fee/gas model.
7. Canonical USDC representation before Circle native support.
8. Smart-account standard.
9. Upgradeability strategy.
10. DEX architecture: custom vs audited/proven components.
11. StableSwap invariant.
12. Concentrated-liquidity design.
13. RFQ signature/settlement standard.
14. Intent format.
15. Internal ledger architecture.
16. Indexer architecture.
17. Cross-chain abstraction.
18. Arc adapter design.
19. Fiat-provider abstraction.
20. Oracle providers/fallback rules.
21. Key management/MPC/HSM.
22. Governance/security council.
23. Monitoring stack.
24. API versioning/idempotency rules.
25. Compliance boundary between protocol and hosted services.

---

# 39. Recommended first repository milestones

### Milestone A - boot

```text
make devnet-up
make devnet-status
make devnet-down
```

One command should boot the local chain environment.

### Milestone B - prove

Submit a transaction -> include it in L2 -> batch -> prove -> submit/finalize against Ethereum testnet -> expose status through API/explorer.

### Milestone C - account

Create smart account -> fund with test USDC -> send -> pay fee without requiring user-managed ETH.

### Milestone D - exchange

Create USDC/EURC pool -> add liquidity -> quote -> swap -> index -> ledger -> receipt.

### Milestone E - route

Compare the network quote against Arc/external adapter -> simulate -> execute chosen route -> reconcile.

### Milestone F - settle

Institution A + Institution B -> approval policy -> DvP/PvP -> atomic settlement -> proof/finality -> settlement receipt.

### Milestone G - fiat

Provider sandbox -> bank/fiat test flow -> stablecoin -> the network account -> reverse flow -> reconciliation.

---

# 40. Product statement

### One sentence

**A USDC-native institutional settlement network built as a Lineth ZK rollup, unifying fiat, stablecoins, tokenized assets and EVM applications through a single programmable account.**

### Technical statement

**The network combines Lineth EVM execution and ZK proving, Ethereum settlement, USDC as the primary monetary asset, Circle interoperability/coordination infrastructure, permissionless native liquidity and regulated fiat edges behind an intent-driven account and settlement architecture.**

### Vision

> **One account for the onchain and offchain financial system.**

---

# 41. Authoritative references to keep with the project

These are starting references; pin exact versions/commits in ADRs during implementation.

- Lineth / LF Decentralized Trust overview: https://www.lfdecentralizedtrust.org/blog/announcing-lineth-a-production-grade-zk-rollup-stack-joins-linux-foundation-decentralized-trust
- Circle developer platform: https://www.circle.com/developer
- Circle USDC: https://www.circle.com/usdc
- Circle Gateway: https://www.circle.com/gateway
- Circle Paymaster: https://www.circle.com/paymaster
- Circle CCTP overview/support: https://help.circle.com/support/en/getting-started-with-cctp-cross-chain-transfer-protocol?id=kb_article_view&sys_kb_id=961f11cc3bf5435006839064c3e45aa3
- Arc overview: https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance
- Arc documentation: https://docs.arc.io/
- Bridge crypto/DeFi solution: https://www.bridge.xyz/solutions/crypto-and-defi

---

# 42. Current external facts used in this blueprint (September 2026)

- Lineth is described by LF Decentralized Trust as a production-grade, EVM-equivalent ZK rollup stack covering the full L2 pipeline, with Besu execution, Maru block production/consensus, coordinator, prover and Ethereum L1 contracts.
- Circle currently presents its developer stack as Wallets for UX, Contracts for execution, Gateway for balance abstraction, CCTP for cross-chain movement and Arc for coordination.
- Gateway is currently positioned as a unified USDC balance/liquidity primitive across supported chains; support for the network would require Circle/network support rather than being automatic.
- CCTP is Circle's native USDC burn/mint cross-chain utility on supported networks.
- Circle Paymaster currently supports paying gas in USDC on supported chains and supports smart-account/EOA patterns described by Circle; the network needs its own compatible strategy until directly supported.
- Arc is a separate Circle L1 optimized for stablecoin finance; it is not the base chain for the Lineth rollup.
- Native USDC availability on Linea does not imply automatic native USDC availability on a new Lineth deployment.

---

# 43. Development rule

Every implementation decision should answer this question:

> **Does this move us toward one programmable account that can safely coordinate fiat, USDC, ERC-20 assets, EVM execution, cross-chain liquidity and institutional settlement without exposing infrastructure complexity to the user?**

If the answer is no, it is probably not core to the product.

