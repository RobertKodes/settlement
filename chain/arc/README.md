# chain/arc — Arc Testnet deployment (Circle's L1, chain 5042002)

Arc is a real dependency, not something we run. What we put there: the venue (`VenueFactory`/`VenueRouter`) that
Metapad graduates into, the account layer (`EntryPoint` v0.8 + `PasskeyAccountFactory`; no paymaster because gas
on Arc is USDC), and `DvPSettlement`. Facts (docs.arc.io, 2026-09-16): RPC `https://rpc.testnet.arc.io`, explorer
`https://explorer.testnet.arc.io`, USDC ERC-20 view `0x3600000000000000000000000000000000000000` (6 dec) over the
native gas balance (18 dec), EURC testnet `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, CCTP V2 domain 26,
Gateway, Permit2 and the CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C` present; the mempool
enforces a 20 gwei `maxFeePerGas` floor.

```sh
make arc-key        # generates chain/arc/deployer.env (gitignored) and prints the address to fund
                    # -> fund it with testnet USDC at https://faucet.circle.com (select Arc Testnet)
make arc-deploy     # DeployVenue.s.sol on Arc Testnet -> chain/deployments/arc-testnet.json
make arc-status     # balance of the deployer, deployed addresses, chain head
```

The owner funds the deployer; nothing here can claim faucet funds. Until `arc-deploy` has run, every Arc leg the
router plans is marked `BLOCKED: arc contracts not deployed`.
