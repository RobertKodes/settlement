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

Supported today: `transfer` intents of USDC on `l2-devnet` to an address or an account handle. Every
other action or asset fails the quote with `unsupported_intent` and the intent moves to `FAILED_QUOTE`.
