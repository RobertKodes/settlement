# services/api — product API (`/v1`)

Fastify + zod, conventions in `docs/api/conventions.md` (ADR-0024). Persistence in Postgres (schema
`services/ledger/migrations`), execution through `@settlement/chain` on the configured network.

## Endpoints

| method | path | purpose |
|---|---|---|
| `GET` | `/v1/health` | process liveness + chain probes (chain id, head block) |
| `POST` | `/v1/accounts` | create a product account bound to a passkey `{qx, qy, salt}`; returns its counterfactual L2 address |
| `GET` | `/v1/accounts/:handle` | look an account up |
| `POST` | `/v1/intents` | create an intent (`Idempotency-Key` required, `X-Account-Id` until auth exists) → `CREATED` |
| `GET` | `/v1/intents/:id` | status, failure code, flow state |
| `POST` | `/v1/intents/:id/quote` | build the unsigned user operation and the EIP-2612 permit digest; fee bounds in USDC → `QUOTED` |
| `POST` | `/v1/intents/:id/authorize` | `{permitSignature}` → returns the user-op hash to sign; `{permitSignature, signature}` → submits through the paymaster → `SETTLED` (ledger posted) or `FAILED_EXECUTION` |
| `POST` | `/v1/accounts/:handle/policy` | approval thresholds `{thresholds:[{aboveBaseUnits, approvals}]}` (blueprint section 6) |
| `POST` | `/v1/intents/:id/sign` | `settle` intents: `{party: A|B, signature, permit?}` each party's authorization of the DvP typed data |
| `POST` | `/v1/intents/:id/approve` | `{approver}` records an approval against the governing policy |
| `POST` | `/v1/intents/:id/execute` | `settle` intents: with both signatures and every required approval, the settlement agent runs `DvPSettlement.settleWithPermits` atomically → `SETTLED` |
| `POST` | `/v1/fiat/onramp` | `{accountId, currency, amount}` → provider transfer + bank instructions (Milestone G) |
| `POST` | `/v1/fiat/offramp` | `{accountId, beneficiaryId, amountBaseUnits}` → provider payout request; client funds the treasury with a transfer intent |
| `POST` | `/v1/webhooks/fiat/:provider` | provider events, signature-verified and de-duplicated; `payment_processed` credits USDC and posts `fiat_in` |
| `GET` | `/v1/fiat/transfers/:provider/:id` | our record + the provider's live state |
| `POST` | `/v1/reconciliation/run` | ledger `available` balances vs on-chain balances (`{accountId}` to scope); writes `reconciliation_run` |
| `GET` | `/v1/reconciliation/runs` | last 20 runs with breaks |
| `GET` | `/v1/systems` | what the orchestration layer reaches (Lineth, Arc, CCTP domains) and the BLOCKED list (v2) |
| `POST` | `/v1/routes/plan` | candidate plans with legs across Lineth / Arc / CCTP, scores and BLOCKED reasons (v2) |
| `GET` | `/v1/accounts/:handle/portfolio` | unified account with provenance per line |
| `GET` | `/v1/accounts/:handle/intents` | the account's intents, newest first |
| `POST` | `/v1/devnet/faucet` | devnet only: mint test stablecoins |
| `GET` | `/v1/settlements/:intentId` | settlement receipt (blueprint section 10) with live L1 finality; moves `SETTLED → PROVEN` |

The passkey signs exactly two digests, both returned by the API: the permit (fee allowance for the
paymaster) and the EntryPoint v0.8 user-op hash. The server never holds user keys; the bundler key it
holds only pays L2 gas in ETH and is reimbursed in USDC by the paymaster's deposit.

## Run locally

```sh
make services-up && make ledger-migrate      # Postgres :5439 with schema v1 + 0002
make devnet-up && make devnet-deploy && make devnet-milestone-c   # chain + contracts
pnpm --filter @settlement/api dev            # http://localhost:3000, chain deps read from chain/lineth/deployments.local.json
pnpm --filter @settlement/api test:devnet    # end-to-end flow test (needs both of the above)
```

Supported today on `l2-devnet`: `transfer` (USDC), `swap` (USDC<->EURC through the router and the native StableSwap pool),
`settle` (atomic DvP/PvP between two accounts, `destination.amount` is the counter-leg). Accounts are deployed on creation
so ERC-1271 signatures verify for settlements. Every
other action or asset fails the quote with `unsupported_intent` and the intent moves to `FAILED_QUOTE`.
