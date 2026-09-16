#!/usr/bin/env bash
# make devnet-status — service state, chain IDs, block heights, LINEA namespace probe. Exit 1 if L2 is down.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_upstream; load_devnet_env
if ! docker info >/dev/null 2>&1; then die "docker daemon unreachable (colima start --cpu 6 --memory 12)"; fi
if [ ! -f "$STACK_DIR/.env" ]; then warn "devnet never started (no $STACK_DIR/.env) — make devnet-up"; exit 1; fi

printf '\n%s== services ==%s\n' "$c_cyn" "$c_off"
compose ps --format 'table {{.Service}}\t{{.Status}}' 2>/dev/null || warn "compose ps failed"

probe() { # probe <label> <url> <expected-chain-id>
  local cid bn
  cid=$(hex2dec "$(rpc "$2" eth_chainId)"); bn=$(hex2dec "$(rpc "$2" eth_blockNumber)")
  if [ "$cid" = "$3" ]; then ok "$1 $2  chainId=$cid  block=$bn"; return 0
  else printf '%s[down]%s %s %s  chainId=%s (want %s)\n' "$c_red" "$c_off" "$1" "$2" "${cid:-none}" "$3"; return 1; fi
}
printf '\n%s== rpc ==%s\n' "$c_cyn" "$c_off"
probe L1 "$L1_HOST_RPC_URL" "$L1_CHAIN_ID" || true
probe L2 "$L2_HOST_RPC_URL" "$L2_CHAIN_ID" || exit 1
# LINEA namespace probe: any JSON-RPC answer other than "method not found" (-32601) proves the namespace
# is served; an unfunded sender legitimately gets an "up-front cost" error back from the same endpoint.
lg=$(curl -sS -m 5 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"linea_estimateGas","params":[{"from":"0x0000000000000000000000000000000000000001","to":"0x0000000000000000000000000000000000000002","value":"0x0"}]}' "$L2_HOST_RPC_URL" 2>/dev/null)
case "$lg" in
  *'"result"'*) ok "linea_estimateGas namespace live" ;;
  *-32601*|"") warn "linea_estimateGas not served yet (sequencer still starting?)" ;;
  *) ok "linea_estimateGas namespace live (replied: $(printf '%s' "$lg" | sed -E 's/.*"message":"([^"]{0,60}).*/\1/'))" ;;
esac
# Milestone B: what the L1 rollup contract has finalized (proof verified on L1) vs the L2 head.
addrs="$STACK_DIR/artifacts/deployments/addresses.json"
rollup=$( [ -f "$addrs" ] && python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print((d.get("l1") or {}).get("LinethRollupV8") or d.get("LinethRollupV8") or "")' "$addrs" 2>/dev/null)
if [ -n "$rollup" ]; then
  fin=$(rpc "$L1_HOST_RPC_URL" eth_call "[{\"to\":\"$rollup\",\"data\":\"0x695378f5\"},\"latest\"]")   # currentL2BlockNumber()
  head=$(hex2dec "$(rpc "$L2_HOST_RPC_URL" eth_blockNumber)")
  [ -n "$fin" ] && ok "L1 finality: rollup $rollup finalized L2 block $(hex2dec "$fin") of $head" || warn "L1 finality: rollup $rollup not answering"
fi
if [ -f "$LINETH_DIR/deployments.local.json" ]; then
  ok "devnet contracts: $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(", ".join(f"{k}={v}" for k,v in d["contracts"].items()))' "$LINETH_DIR/deployments.local.json")"
fi
if command -v cast >/dev/null 2>&1; then
  printf '\n%s== L2 latest block (cast) ==%s\n' "$c_cyn" "$c_off"
  cast block latest --rpc-url "$L2_HOST_RPC_URL" -f number -f timestamp -f gasUsed 2>/dev/null | paste - - - | sed 's/^/  number\/timestamp\/gasUsed: /' || true
fi
if [ -x "$STACK_DIR/scripts/status.sh" ]; then
  printf '\n%s== upstream status ==%s\n' "$c_cyn" "$c_off"
  ( cd "$STACK_DIR" && LINETH_SKIP_BANNER=1 ./scripts/status.sh ) 2>&1 | tail -n 40 || true
fi
