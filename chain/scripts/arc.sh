#!/usr/bin/env bash
# make arc-key | arc-deploy | arc-status — Arc Testnet deployment helpers (chain/arc/README.md).
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ARC_DIR="$REPO_ROOT/chain/arc"; KEYFILE="$ARC_DIR/deployer.env"; OUT="$REPO_ROOT/chain/deployments/arc-testnet.json"
ARC_RPC="${ARC_RPC:-https://rpc.testnet.arc.io}"; ARC_USDC=0x3600000000000000000000000000000000000000
require_cmd cast; require_cmd forge
mkdir -p "$REPO_ROOT/chain/deployments"
case "${1:-}" in
  key)
    if [ -f "$KEYFILE" ]; then info "deployer exists: $(sed -n 's/^ARC_DEPLOYER_ADDRESS=//p' "$KEYFILE")"; exit 0; fi
    w=$(cast wallet new --json | python3 -c '
import json,sys
d=json.load(sys.stdin)
d=d.get("data", d) if isinstance(d, dict) else d
d=d[0] if isinstance(d,list) else d
addr=next(v for k,v in d.items() if k.lower()=="address"); pk=next(v for k,v in d.items() if "private" in k.lower())
print(addr, pk)')
    set -- $w
    printf 'ARC_DEPLOYER_ADDRESS=%s\nARC_DEPLOYER_KEY=%s\n' "$1" "$2" > "$KEYFILE"; chmod 600 "$KEYFILE"
    ok "deployer $1 written to $KEYFILE (gitignored)"
    info "fund it with Arc Testnet USDC at https://faucet.circle.com, then: make arc-deploy" ;;
  deploy)
    [ -f "$KEYFILE" ] || die "no deployer: make arc-key"
    set -a; . "$KEYFILE"; set +a
    bal=$(cast balance "$ARC_DEPLOYER_ADDRESS" --rpc-url "$ARC_RPC")
    [ "$bal" != "0" ] || die "deployer $ARC_DEPLOYER_ADDRESS holds no USDC on Arc Testnet — fund it at https://faucet.circle.com"
    info "deploying venue + accounts + DvP on Arc Testnet from $ARC_DEPLOYER_ADDRESS (balance $(cast from-wei "$bal") USDC)"
    ( cd "$REPO_ROOT/protocol/contracts" && DEPLOYER_KEY="$ARC_DEPLOYER_KEY" QUOTE_TOKEN="$ARC_USDC" SOLIDITY_P256=true \
        forge script script/DeployVenue.s.sol --rpc-url "$ARC_RPC" --broadcast --private-key "$ARC_DEPLOYER_KEY" --with-gas-price 25gwei 2>&1 | tee /tmp/arc-deploy.log | grep -E "^  [A-Za-z]|ONCHAIN|Error" ) \
      || { tail -20 /tmp/arc-deploy.log; die "Arc deployment failed (log: /tmp/arc-deploy.log)"; }
    python3 - "$REPO_ROOT/protocol/contracts/broadcast/DeployVenue.s.sol/5042002/run-latest.json" "$OUT" <<'PY'
import json, sys, datetime
run = json.load(open(sys.argv[1]))
addrs = {t["contractName"]: t["contractAddress"] for t in run["transactions"] if t["transactionType"] == "CREATE"}
doc = {"chainKey": "arc-testnet", "chainId": 5042002, "deployedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
       "contracts": {**addrs, "USDC": "0x3600000000000000000000000000000000000000", "EURC": "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"}}
json.dump(doc, open(sys.argv[2], "w"), indent=2); open(sys.argv[2], "a").write("\n")
for k, v in doc["contracts"].items(): print(f"  {k:24s} {v}")
PY
    ok "written $OUT" ;;
  status)
    echo "Arc Testnet $ARC_RPC: chain $(cast chain-id --rpc-url "$ARC_RPC") head $(cast block-number --rpc-url "$ARC_RPC")"
    if [ -f "$KEYFILE" ]; then set -a; . "$KEYFILE"; set +a; echo "deployer $ARC_DEPLOYER_ADDRESS: $(cast from-wei "$(cast balance "$ARC_DEPLOYER_ADDRESS" --rpc-url "$ARC_RPC")") USDC (native)"; else echo "no deployer (make arc-key)"; fi
    [ -f "$OUT" ] && python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); [print(f"  {k:24s} {v}") for k,v in d["contracts"].items()]' "$OUT" || echo "not deployed (make arc-deploy)" ;;
  *) die "usage: arc.sh key|deploy|status" ;;
esac
