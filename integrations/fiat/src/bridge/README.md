# Bridge adapter (planned)

First `FiatProvider` implementation. Not written yet; this records the mapping so the interface stays
honest.

- Base URL: `https://api.sandbox.bridge.xyz/v0` (sandbox, keys `sk-test…`; sandbox access is granted by
  Bridge support). Production `https://api.bridge.xyz/v0`.
- The sandbox only reliably exercises customer creation and KYC; treat it as schema testing.

| `FiatProvider` method | Bridge resource |
|---|---|
| `createCustomer` | `POST /v0/customers` (KYC links / KYB) |
| `createOnRamp` | `POST /v0/transfers` with a fiat source and a crypto destination |
| `createOffRamp` | `POST /v0/transfers` with a crypto source and an external account destination, or a liquidation address |
| `createVirtualAccount` | `POST /v0/customers/{id}/virtual_accounts` |
| `getQuote` | transfer preview / static templates |
| `getTransferStatus` | `GET /v0/transfers/{id}` |
| `webhookVerify` | webhook signature header per Bridge docs; every event id stored for de-duplication |
| `reconcile` | list transfers since a cursor, compare against `fiat_transfer` rows |

Rails documented per currency: USD (Wire / ACH / Same-Day ACH / FedNow), EUR (SEPA, SEPA Instant),
GBP (FPS), BRL (Pix), MXN (SPEI), COP.
