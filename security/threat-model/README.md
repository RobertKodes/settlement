# Threat model

Blueprint section 29 categories. Status is per mitigation: `planned`, `partial`, `done`. A feature is
not done until this table is updated (blueprint section 34).

| area | threat | component | mitigation | status | ADR |
|---|---|---|---|---|---|
| rollup | sequencer compromise | Maru / Besu sequencer | single operator for now; forced inclusion on L1 + escape hatch (upstream); multi-operator QBFT roadmap | planned | 0004 |
| rollup | coordinator compromise | coordinator | isolated host, signer in Web3Signer/KMS, alerting on submission gaps | planned | 0004 |
| rollup | prover failure / bug | prover | dev prover only locally; real prover on amd64 with queue-depth alerting; upstream security advisories tracked | planned | 0005 |
| rollup | L1 submission failure | coordinator / L1 RPCs | multiple L1 providers, blob fee caps, finalization-lag alert | planned | 0002 |
| rollup | configuration error (chain ID, genesis) | chain/ | `bootstrap.sh` cross-checks the 3 chain-ID files; `preflight.sh` before every boot | done | 0002 |
| rollup | upgrade-key compromise | L1 contracts | security council multisig + timelock for non-emergency upgrades | planned | 0009, 0022 |
| rollup | RPC censorship / outage | RPC gateway | multiple RPC operators, public endpoints, status page | planned | 0004 |
| dex | reentrancy, arithmetic, invariants | protocol/contracts | Foundry fuzz + invariant suites required per pool; CI runs `forge test` | partial | 0010 |
| dex | oracle manipulation | OracleAdapter | primary + fallback, freshness and deviation limits; no thin-pool spot as security oracle | planned | 0020 |
| dex | MEV / sandwiching | Router | deadline + minOut mandatory; private order flow and RFQ for size | planned | 0010 |
| dex | malicious tokens | PoolFactory | token-behaviour validation before listing | planned | 0010 |
| dex | signature replay, RFQ signer compromise | RFQSettlement | EIP-712 domain separation, nonces, expiry, maker key rotation | planned | 0013 |
| cross-chain | wrong domain / replay | CCTP adapter | domain table in `@settlement/config`, `destinationCaller` set, message de-dup by nonce | partial | 0017 |
| cross-chain | attestation failure / stuck state | CCTP, Gateway | reconciliation job with break reporting (`reconciliation_run`) | partial | 0017 |
| cross-chain | unsupported-chain assumption | all adapters | our chain has no CCTP domain until Circle supports it; adapters refuse unknown domains | done | 0017 |
| fiat | webhook forgery / duplicate events | fiat adapter | `webhookVerify` mandatory; `fiat_transfer.last_event_id` de-dup; signed webhooks outbound | partial | 0019 |
| fiat | bank return / reversal | ledger | reversing `ledger_transaction`, never edits; `returned` state modelled | done | 0015 |
| fiat | identity mismatch / provider outage | fiat adapter | provider abstraction, onboarding state machine, ops dashboard | planned | 0019 |
| accounts | passkey compromise, session theft | auth | WebAuthn, device binding, MFA for institutions, session revocation | planned | 0008 |
| accounts | user-op signature forgery / replay | PasskeyAccount | P-256 over the EntryPoint v0.8 typed-data hash (chain id + entry point in the domain), EntryPoint nonces; wrong-key op rejected in tests | partial | 0008 |
| accounts | ERC-1271 cross-context replay | PasskeyAccount | per-account key today; ERC-7739 rehashing before production | planned | 0008 |
| accounts | server-side authorization bypass | services/api | the API only relays: an intent executes solely with the passkey's two signatures (permit + user-op hash) returned by the quote; the bundler key cannot move user funds | done | 0008, 0024 |
| settlement | one leg settles without the other | DvPSettlement | both legs in one transaction, `LegMismatch` check, tested rollback when a leg fails | done | 0013 |
| settlement | settlement replay / stale terms | DvPSettlement | EIP-712 id executes once, deadline, either party can cancel, nonce = intent id | done | 0013 |
| settlement | payment above policy without approval | services/api | approvals recorded per governing policy; `FAILED_POLICY` terminal, tested | done | 0025 |
| ledger | double posting on retry | services/api ledger poster | `ledger_post` idempotency key `intent:<id>`; API-level `Idempotency-Key` on creation | done | 0015, 0024 |
| gas | paymaster drained by over-charging or unbounded permits | USDCPaymaster | prefund capped at `maxCost` and at `permitAmount`, refund in `_postOp`, permit amount checked before pulling funds | partial | 0006 |
| gas | stale/manipulated token price | USDCPaymaster | owner-set stub on the devnet; OracleAdapter with freshness/deviation bounds before any real value | planned | 0006, 0020 |
| accounts | recovery abuse, privilege escalation, malicious delegate | policy engine | N-of-M approvals, new-recipient secondary approval, agent budgets, audit trail | partial (schema) | 0008 |
| accounts | API key leakage | api_key | hashed storage, scopes, IP allowlist, rotation, prefix display only | partial (schema) | 0024 |
| operations | CI / dependency compromise | infra/ci | pinned actions, `--frozen-lockfile`, submodule pinning, signed images (later) | partial | 0021 |
| operations | secret leakage | all | no secrets in repo (`.gitignore`), KMS/HSM for privileged keys, dev keys clearly labelled | partial | 0021 |
| operations | insider risk, DNS/domain compromise, deployment mismatch | ops | role separation, registrar lock, immutable release tags, `NetworkVersion.VERSION` probe | planned | 0021 |

## How to update
Add a row when a threat is identified, change `status` when a mitigation lands, and link the ADR that
records the decision. PRs touching contracts, adapters or auth must touch this file or say why not.
