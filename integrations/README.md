# integrations/

Provider adapters behind interfaces the router and ledger depend on. Each package ships the interface,
an in-memory mock, and tests; the network implementations land per phase.

| package | status | phase |
|---|---|---|
| `circle/cctp` | interface + mock | 5 |
| `circle/gateway` | interface + mock | 5 |
| `circle/arc` | interface + mock + decimal helpers | 4 |
| `fiat` | interface + mock; Bridge mapping in `fiat/src/bridge/README.md` | 8 |
| `circle/wallets` | not started (ERC-4337 + ERC-6900, passkeys; ADR-0008) | 2 |
| `circle/paymaster` | not started (own paymaster on the L2, Circle's where supported; ADR-0006) | 2 |
| `oracles` | not started (ADR-0020) | 3 |
| `custody` | not started (ADR-0021) | 6 |
