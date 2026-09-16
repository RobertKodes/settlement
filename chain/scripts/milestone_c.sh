#!/usr/bin/env bash
# make devnet-milestone-c — run script/MilestoneC.s.sol against the running L2 and record the addresses.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_upstream; load_devnet_env; require_cmd forge
dep="$LINETH_DIR/deployments.local.json"
[ -f "$dep" ] || die "no $dep — run make devnet-deploy first"
usdc=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["contracts"]["TestUSDC"])' "$dep")
key=$(sed -n "s/^L2_DEPLOYER_PRIVATE_KEY='\{0,1\}\(0x[0-9a-fA-F]*\)'\{0,1\}$/\1/p" "$STACK_DIR/artifacts/accounts/runtime-keys.env")
[ -n "$key" ] || die "L2 deployer key missing"
info "Milestone C on $L2_HOST_RPC_URL with TestUSDC $usdc"
( cd "$REPO_ROOT/protocol/contracts" && DEPLOYER_KEY="$key" TEST_USDC="$usdc" forge script script/MilestoneC.s.sol --rpc-url "$L2_HOST_RPC_URL" --broadcast --private-key "$key" 2>&1 | tee /tmp/milestone-c.log | grep -E "^  [A-Za-z]|ONCHAIN|Error|revert" ) || { tail -30 /tmp/milestone-c.log; die "MilestoneC script failed (log: /tmp/milestone-c.log)"; }
python3 - "$dep" "$REPO_ROOT/protocol/contracts/out/milestone-c.json" <<'PY'
import json, sys
dep, res = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
dep["contracts"].update({k: v for k, v in res.items() if k != "feeUsdcBaseUnits"})
dep["milestoneC"] = {"feeUsdcBaseUnits": res["feeUsdcBaseUnits"]}
json.dump(dep, open(sys.argv[1], "w"), indent=2); open(sys.argv[1], "a").write("\n")
PY
ok "Milestone C passed on the devnet; addresses merged into $dep"
