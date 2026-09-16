#!/usr/bin/env bash
# make devnet-up — configure the upstream quickstart through its wizard, boot it, wait for both RPCs.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
bash "$(dirname "${BASH_SOURCE[0]}")/preflight.sh"
load_devnet_env

wait_for_rpcs() {
  info "waiting for RPCs (L1 $L1_HOST_RPC_URL chain $L1_CHAIN_ID, L2 $L2_HOST_RPC_URL chain $L2_CHAIN_ID; up to ${DEVNET_WAIT_SECONDS:-900}s)"
  local deadline=$(( $(date +%s) + ${DEVNET_WAIT_SECONDS:-900} )) l1 l2
  while :; do
    l1=$(hex2dec "$(rpc "$L1_HOST_RPC_URL" eth_chainId)"); l2=$(hex2dec "$(rpc "$L2_HOST_RPC_URL" eth_chainId)")
    [ "$l1" = "$L1_CHAIN_ID" ] && [ "$l2" = "$L2_CHAIN_ID" ] && break
    [ "$(date +%s)" -lt "$deadline" ] || die "timed out: L1 chainId=$l1 (want $L1_CHAIN_ID), L2 chainId=$l2 (want $L2_CHAIN_ID) — make devnet-logs, or ./scripts/watch.sh in $STACK_DIR"
    sleep 5
  done
  ok "L1 chain $l1 and L2 chain $l2 answering"
}

# 0. Resume path: containers recorded by down.sh still exist -> just start them (no wizard, no re-genesis).
#    DEVNET_FRESH=1 forces the cold path; make devnet-reset wipes everything.
if [ "${DEVNET_FRESH:-0}" != 1 ] && [ -s "$RESUME_FILE" ] && [ -f "$STACK_DIR/.env" ]; then
  existing=$(compose_all ps -a --format '{{.Service}}' 2>/dev/null | sort -u)
  missing=$(comm -23 <(sort -u "$RESUME_FILE") <(printf '%s\n' "$existing"))
  if [ -z "$missing" ]; then
    info "resuming $(wc -l < "$RESUME_FILE" | tr -d ' ') recorded services (state kept)"
    # shellcheck disable=SC2046
    compose_all start $(cat "$RESUME_FILE")
    wait_for_rpcs
    bash "$(dirname "${BASH_SOURCE[0]}")/status.sh"
    exit 0
  fi
  warn "cannot resume: containers missing for: $(echo $missing) — cold start instead"
fi
cd "$STACK_DIR"

# 1. Wizard writes .env deterministically from flags (flag > WIZARD_* env > existing .env > .env.example).
info "configuring: ./scripts/start.sh --wizard --non-interactive --yes --l1-mode $L1_MODE --prover $WIZARD_PROVER"
LINETH_SKIP_BANNER=true ./scripts/start.sh --wizard --non-interactive --yes --l1-mode "$L1_MODE" --prover "$WIZARD_PROVER"
got=$(sed -n 's/^L2_CHAIN_ID=//p' .env | tail -1); got=${got:-1337}
[ "$got" = "$L2_CHAIN_ID" ] || die "quickstart .env has L2_CHAIN_ID=$got but devnet.env says $L2_CHAIN_ID"

# 2. Upstream's check-ports.sh is a plain listener test and start.sh treats every run as a cold start
#    (its manual: "stop but keep state"). Stop whatever is running first; volumes and artifacts are kept.
running=$(compose --profile local-l1 --profile stack-partial-prover ps -q 2>/dev/null | wc -l | tr -d ' ')
if [ "${running:-0}" -gt 0 ]; then
  info "stopping $running running stack containers before the cold-start checks (state is kept)"
  compose --profile local-l1 --profile stack-partial-prover stop >/dev/null
fi

# 3. pnpm overlay on the vendored tree (see apply_upstream_overlay in lib.sh).
apply_upstream_overlay

# 4. Boot. Without --tail, start.sh returns right after `docker compose up -d`; we do our own waiting.
info "booting: ./scripts/start.sh ${DEVNET_START_FLAGS:-}"
# shellcheck disable=SC2086
LINETH_SKIP_BANNER=true ./scripts/start.sh ${DEVNET_START_FLAGS:-}

# 5. Wait for both chains, then report.
wait_for_rpcs
bash "$(dirname "${BASH_SOURCE[0]}")/status.sh"
