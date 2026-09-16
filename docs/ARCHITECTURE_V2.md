# Architecture v2 — the settlement platform on Lineth and Arc

Written 2026-09-16 after two corrections from the owner: (1) use the real Lineth rollup work and the real Arc, do
not copy either, and (2) this is **not a new public blockchain**. It also folds in the Metapad handoff ("Metapad ×
Settlement — the Arc venue and the Lineth settlement layer"). It supersedes the parts of the original blueprint
that read as "launch an L2 ecosystem". Decisions here override ADRs where they conflict; the ADRs get follow-up edits.

## 1. What the product is, in one paragraph

A USDC-native institutional settlement platform. Institutions and Metapad's venues hold **one programmable account**;
they express **intents** (pay, convert, settle asset-versus-payment, launch, trade); a **policy engine** authorizes;
a **smart router** plans a route across systems; a **settlement engine** executes it leg by leg; an institutional
**ledger** records it with provenance; **reconciliation** proves the books match the chains; **fiat orchestration**
connects banks. Underneath, three real infrastructures do the work and we own none of them:

| infrastructure | what it is for us | operated by |
|---|---|---|
| **Arc** (Circle's L1, chain 5042 / testnet 5042002) | where USDC/EURC live and trade: the venue for Metapad's bonding curves and our own pools, StableFX for institutional FX, gas paid in USDC | Circle |
| **Lineth rollup** (our instance of the LFDT Lineth stack) | the ZK-proven settlement layer: DvP/PvP contracts, institutional accounts, policy-enforced execution, receipts, state proven to Ethereum | us (sequencer at launch), proofs verified on Ethereum |
| **Circle stack** (USDC, CCTP V2, Gateway) | canonical USDC and the rails between chains | Circle |
| **Bridge** (Stripe) | card/bank ↔ USDC | Bridge |

The Lineth rollup is **private settlement infrastructure**, not a public chain: no token, no third-party ecosystem,
no "come deploy on us". It exists so that the platform's settlement state has a ZK proof on Ethereum that anyone
can verify, the same way a bank's core ledger is audited, except the audit is a proof. That is why the A–G work is
kept, and why it stays narrow.

## 2. Responsibilities, and what each system must never do

### Arc — money home and venue
- Holds Circle-issued USDC (native gas asset, 18 decimals; ERC-20 view at `0x3600…0000`, 6 decimals) and EURC
  (testnet `0x89B5…D72a`, mainnet `0xbEf5…21c1`).
- Hosts the **venue**: Metapad's bonding curves (their `LaunchpadFactory`, EIP-1167 launchpads, graduation through a
  `UniswapV2Migrator`) and **our own constant-product pools** that graduation targets. Because Metapad's migrator
  speaks the UniswapV2 factory/pair interface, our venue on Arc is a UniswapV2-compatible AMM we deploy and own,
  quoted in USDC.
- Hosts **StableFX**: Circle's permissioned RFQ API with on-chain escrow (`FxEscrow` `0xe2E5…DFe6`, mainnet and
  testnet) for USDC↔EURC. Access needs an institutional API key from a Circle representative → **BLOCKED** until
  granted; the adapter is typed and mocked until then.
- Has CCTP V2 (domain 26; `TokenMessengerV2` `0x28b5…cf5d`, `MessageTransmitterV2` `0x81D4…4B64`), Gateway
  (`GatewayWallet` `0x7777…00eE`, `GatewayMinter` `0x2222…C205`), Permit2, Multicall3 and the CREATE2 factory
  `0x4e59…956C` at the same addresses on mainnet and testnet. No ERC-4337 EntryPoint is documented: we deploy our
  own EntryPoint v0.8 on Arc (through the CREATE2 factory), and because gas is USDC there, **accounts on Arc need
  no paymaster**: the account's own native balance is USDC.
- Never: rebuilt, forked, or replaced. We deploy contracts *on* it.

### Lineth rollup — settlement layer
- Runs the real stack (Besu + Maru + coordinator + prover + L1 rollup contracts). Locally it is the devnet from
  Milestone A; the shared environment settles to Sepolia; production to Ethereum mainnet (ADR-0002).
- Hosts the **settlement contracts**: `DvPSettlement` (atomic DvP/PvP), `PasskeyAccount` + factory, `USDCPaymaster`
  (gas in USDC because Lineth's gas is ETH), the internal `StableSwapPool`, and later tokenized-asset contracts.
- Its USDC is **not Circle-issued** until Circle grants a CCTP domain and native issuance (ADR-0007 test tokens today;
  a bridged representation on the shared devnet). Until then value arrives on the rollup only through our own
  canonical bridge from Ethereum, and the router treats "Lineth USDC" as a distinct asset with distinct provenance.
  **BLOCKED** externally; typed adapters + mocks + explicit status meanwhile.
- Never: marketed as a general-purpose chain; no token; no public deploy story.

### Circle stack — rails
- CCTP V2 moves USDC between supported chains (Arc 26, Base 6, Linea 11, Ethereum 0, …) in seconds (Fast) or at
  finality (Standard). Gateway gives a unified USDC balance across supported chains with sub-second mints.
- Both are **real on Arc Testnet today**, so the control surface can move USDC between Arc and other CCTP chains
  now. Neither touches the Lineth rollup until Circle supports it.

### Bridge — fiat edge
- Card/bank → USDC on a Bridge-supported chain, and back. If Arc is not a Bridge destination, USDC lands on a
  supported chain (e.g. Base) and one CCTP Fast leg brings it to Arc. Sandbox credentials are granted by Bridge
  support → **BLOCKED** until then; `MockFiatProvider` and the typed `BridgeFiatProvider` exist behind the same routes.

## 3. The orchestration layer (what we own)

```
                    UNIFIED INSTITUTIONAL ACCOUNT
                    (provenance per system: Arc · Lineth · Gateway · fiat · pending)
                                 │
                            INTENT ENGINE          transfer · swap · settle · launch · trade · onramp · offramp
                                 │
                            POLICY ENGINE          thresholds, approvals, allowed assets/counterparties (I)
                                 │
                            SMART ROUTER           route PLAN = ordered legs across systems, simulated and scored
                                 │
           ┌─────────────────────┼──────────────────────┐
           ▼                     ▼                      ▼
   LINETH LEGS             CIRCLE RAIL LEGS          ARC LEGS
   dvp · pvp · transfer    cctp · gateway            pool-swap · stablefx · launchpad-buy/sell
   account op (4337+PM)    burn/attest/mint          account op (4337, gas = USDC)
           │                     │                      │
           └─────────────────────┼──────────────────────┘
                                 ▼
                          SETTLEMENT ENGINE        executes legs in order, one durable state per leg, retries,
                                 │                 compensating actions, receipts per leg + one receipt per intent
                                 ▼
                          LEDGER + RECONCILIATION  double entry per leg; ledger vs chain per (account, chain, asset)
```

**A route is a plan, not a transaction.** The worked example from the correction ("deliver $10M tokenized treasuries,
receive EUR") becomes:

| leg | system | what | proof of completion |
|---|---|---|---|
| 1 | Lineth | DvP: asset → buyer, USDC → seller (atomic) | L2 receipt, later L1 proof |
| 2 | CCTP | seller's USDC Lineth → Arc *(BLOCKED: no domain; today: Sepolia/Base → Arc)* | attestation + mint tx |
| 3 | Arc | USDC → EURC on StableFX *(BLOCKED: API key; today: our USDC/EURC pool on Arc)* | escrow settlement tx |
| 4 | Arc / Bridge | EURC held on Arc, or EUR paid out through Bridge | Arc balance / provider payout |

The router already computes all-in scores per venue; v2 extends it to **plans**: sequences of legs with per-leg
cost, latency, certainty and executability, where a leg's executability is a first-class fact ("BLOCKED: needs
Circle domain") rather than a hidden failure.

The Metapad "walk-in" flow is the same machinery with different legs: `onramp` (Bridge → USDC on Base) → `cctp`
(Base → Arc, Fast) → `trade` (bonding curve on Arc) or `swap` (our pool) → optional `cctp` to any other chain.

## 4. Unified account with provenance

One net figure, every line traceable to a system:

```
USDC
  Arc            chain 5042002, ERC-20 0x3600…, address 0x…      = ledger available? yes
  Lineth         chain 1337, TestUSDC (not Circle-issued)         = ledger available? yes
  Gateway        unified balance API                              (BLOCKED until Gateway depositor set up)
  Pending        3 intents in flight                              from the intent table
EURC
  Arc            …
Positions
  Arc pool LP    our USDC/EURC pool on Arc
  Lineth pool LP StableSwap on the rollup
Fiat
  USD            Bridge transfer awaiting funds
```

`GET /v1/accounts/:handle/portfolio` already produces lines with provenance for Lineth; v2 adds Arc (and Gateway
when available) as further sources. Nothing is ever summed into a fake single ledger balance.

## 5. Contract placement

| contract | Lineth rollup | Arc | notes |
|---|---|---|---|
| EntryPoint v0.8 | ours (local) | ours via CREATE2 factory | canonical address if bytecode matches, else recorded |
| PasskeyAccount + factory | yes | yes | same code; on Arc `_payPrefund` pays native USDC |
| USDCPaymaster | yes | not needed | Arc gas is USDC |
| DvPSettlement | **yes** (settlement layer) | optional later | institutional DvP lives on the proven layer |
| StableSwapPool | yes (internal venue) | yes (USDC/EURC) | |
| Venue: UniswapV2-compatible factory/pair/router | later | **yes, first** | Metapad graduation target |
| TestUSDC/TestEURC | yes | no (real USDC/EURC) | |

## 6. Migration plan (from today's repo)

Everything below keeps A–G working. Each step is a commit with tests.

1. **Docs**: this document, ADR-0017/0018 status edits, STATUS v2 section. *(this commit)*
2. **Venue contracts**: UniswapV2-compatible `VenueFactory`/`VenuePair`/`VenueRouter` in `protocol/contracts/src/venue/`,
   fuzzed (k invariant, no free round trip), deployed to the local Lineth devnet by `make devnet-deploy`, with an
   Arc deploy script and `make arc-deploy` gated on a funded Arc Testnet key.
3. **Router v2**: `RoutePlan` with legs across `lineth | arc | cctp | gateway | fiat`; venue adapters `pool-v2`
   (any chain), `arc-stablefx` (typed, BLOCKED), `metapad-curve` (typed against the handoff's curve math, mock until
   the Metapad contracts are wired); planner tests including a Lineth→CCTP→Arc plan whose CCTP leg is BLOCKED.
4. **Real Circle clients**: `CctpV2Client` (viem + iris sandbox) and `GatewayHttpClient` (testnet API), integration
   tests gated on funded keys; `ArcRpcAdapter` (balances with 6/18 decimals, pool quotes) against Arc Testnet RPC.
5. **API**: chain-scoped deployments (`chain/deployments/<chainKey>.json`), engines per chain, settlement engine that
   executes plans leg by leg with durable leg state in `route`/`execution`, portfolio provenance for Arc, explicit
   `BLOCKED` reasons in quotes.
6. **Bridge client**: `BridgeFiatProvider` against the sandbox API behind the existing `FiatProvider` interface,
   fetch-mocked tests; live once credentials exist.
7. **Terminal**: legs and systems in the route view, provenance per chain in the account view.
8. **Arc deployment**: generate the Arc deployer, fund it from `faucet.circle.com` (owner action), `make arc-deploy`
   (EntryPoint, factory, venue, pool), then the Arc integration tests run live.

## 7. External blockers, stated plainly

| blocker | who | effect until resolved |
|---|---|---|
| CCTP domain + native USDC for the Lineth rollup | Circle | Lineth legs use test USDC; Lineth↔Arc value moves only through the canonical Ethereum bridge; router marks such legs BLOCKED |
| StableFX API key | Circle representative | Arc FX uses our own USDC/EURC pool on Arc; StableFX adapter stays mocked |
| Bridge sandbox credentials | Bridge support | fiat stays on `MockFiatProvider` |
| Arc Testnet funding (USDC gas) | owner via faucet | Arc contracts cannot be deployed from here until the deployer holds USDC |
| Legal review (fiat, securities, custody) | counsel | nothing production-facing ships |
| amd64 prover host + Sepolia deployer | owner | rollup proofs stay dev-mode locally |
