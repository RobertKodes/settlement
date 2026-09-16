# API conventions (ADR-0024)

Applies to every product API under `/v1` (blueprint sections 13 and 28). Stable product APIs, never
raw chain assumptions.

## Versioning
- Path-versioned: `/v1/...`. Breaking changes ship as `/v2`; `/v1` keeps working for a published
  deprecation window (minimum 6 months) and emits `Deprecation` and `Sunset` headers.
- Additive changes (new optional fields, new enum values on *output*) are not breaking. New enum
  values on *input* are.

## Authentication and authorization
- Humans: session cookie bound to a WebAuthn/passkey login; institutions require MFA.
- Machines: `Authorization: Bearer <api key>`; keys are scoped (`intents:write`, `settlements:read`,
  …), optionally IP-restricted, and identify an `api_service` role member of one account.
- Every write is authorized against the account's `policy` rows; an approval requirement returns
  `202 Accepted` with an `approval` object, not an error.

## Idempotency
- Every write accepts `Idempotency-Key` (UUID, client-generated). It is **required** on
  `POST /v1/intents`, `/v1/settlements`, `/v1/transfers`.
- Keys are retained 24 hours per account. A replay with the same payload returns the original
  response and status; a replay with a different payload returns `409 idempotency_conflict`.
- The key is stored on the financial row (`intent.idempotency_key`, `fiat_transfer.idempotency_key`,
  `ledger_transaction.idempotency_key`), which is what makes a retried request a no-op end to end.

## Request IDs and audit
- Every response carries `X-Request-Id` (echoed if supplied, generated otherwise). It is written to
  `audit_event.request_id` and to every log line touched by the request.

## Errors
```json
{ "error": { "code": "policy_denied", "message": "amount exceeds single-approver limit", "details": { "limitBaseUnits": "50000000000" }, "requestId": "req_…" } }
```
- `code` is a stable snake_case identifier from a published list; `message` is for humans and may
  change; `details` is code-specific and documented per code.
- HTTP status mirrors the class: 400 validation, 401/403 auth, 404, 409 conflict/idempotency,
  422 policy/quote rejections, 429 rate limit, 5xx ours.
- Intent failures are **not** HTTP errors: the intent moves to a `FAILED_*` status with
  `failure_code`, and `GET /v1/intents/:id` reports it.

## Money and time
- Amounts are base-unit integer strings with the chain they live on; decimals come from
  `@settlement/config`. Display decimals appear only in `fees` fields explicitly marked as such.
- Timestamps are RFC 3339 with timezone, always UTC on output.

## Pagination
- Cursor-based: `?limit=50&cursor=…`, response `{ "data": [...], "nextCursor": "…" | null }`.
  Never offset pagination on financial lists.

## Webhooks
- `POST` JSON with headers `X-Webhook-Id`, `X-Webhook-Timestamp`, `X-Webhook-Signature: v1=<hex hmac-sha256(timestamp + "." + body)>`
  using the endpoint's secret. Receivers must reject timestamps older than 5 minutes and de-duplicate
  on `X-Webhook-Id`.
- Retries with exponential backoff for 24 hours, then the delivery is marked `dead` and the account
  is notified.

## Rate limits
- Per API key and per account; `429` with `Retry-After`. Quotes and reads have separate budgets
  from writes.
