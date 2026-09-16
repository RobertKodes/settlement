#!/usr/bin/env bash
# make devnet-deploy — deploy the devnet contract bundle (NetworkVersion + TestUSDC) to the running L2
# with the quickstart's generated L2 deployer key, and record the addresses in
# chain/lineth/deployments.local.json (gitignored: addresses change on every devnet-reset).
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_upstream; load_devnet_env; require_cmd forge "curl -L https://foundry.paradigm.xyz | bash && foundryup"
keys="$STACK_DIR/artifacts/accounts/runtime-keys.env"
[ -f "$keys" ] || die "no generated keys at $keys — make devnet-up first"
key=$(sed -n "s/^L2_DEPLOYER_PRIVATE_KEY='\{0,1\}\(0x[0-9a-fA-F]*\)'\{0,1\}$/\1/p" "$keys")
[ -n "$key" ] || die "L2_DEPLOYER_PRIVATE_KEY missing in $keys"
[ "$(hex2dec "$(rpc "$L2_HOST_RPC_URL" eth_chainId)")" = "$L2_CHAIN_ID" ] || die "L2 RPC $L2_HOST_RPC_URL is not chain $L2_CHAIN_ID — make devnet-up"

out="$LINETH_DIR/deployments.local.json"
info "deploying DeployDevnet.s.sol to $L2_HOST_RPC_URL (chain $L2_CHAIN_ID)"
( cd "$REPO_ROOT/protocol/contracts" && DEPLOYER_KEY="$key" forge script script/DeployDevnet.s.sol --rpc-url "$L2_HOST_RPC_URL" --broadcast --private-key "$key" >/tmp/devnet-deploy.log 2>&1 ) \
  || { tail -20 /tmp/devnet-deploy.log; die "forge script failed (log: /tmp/devnet-deploy.log)"; }
python3 - "$REPO_ROOT/protocol/contracts/broadcast/DeployDevnet.s.sol/$L2_CHAIN_ID/run-latest.json" "$out" "$L2_CHAIN_ID" <<'PY'
import json, sys, datetime
run, out, chain = json.load(open(sys.argv[1])), sys.argv[2], int(sys.argv[3])
addrs = {t["contractName"]: t["contractAddress"] for t in run["transactions"] if t["transactionType"] == "CREATE"}
doc = {"chainId": chain, "deployedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "contracts": addrs}
json.dump(doc, open(out, "w"), indent=2); open(out, "a").write("\n")
for k, v in addrs.items(): print(f"  {k:16s} {v}")
PY
ok "addresses written to $out"
