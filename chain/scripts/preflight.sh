#!/usr/bin/env bash
# make devnet-preflight — everything that must be true before `docker compose up` is worth starting.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_upstream
load_devnet_env
require_cmd docker; require_cmd curl; require_cmd git

docker info >/dev/null 2>&1 || die "docker daemon unreachable — run: colima start --cpu 6 --memory 12"
v=$(docker compose version --short 2>/dev/null) || die "docker compose plugin missing (see make doctor)"
version_ge "$v" 2.19 || die "docker compose $v < 2.19 required by the quickstart"
ok "docker compose $v"

mem=$(docker info --format '{{.MemTotal}}')
[ "$mem" -ge 8000000000 ] || die "docker has $((mem/1073741824)) GiB; dev-prover mode needs >= 8 GiB — colima stop && colima start --cpu 6 --memory 12"
ok "docker memory $((mem/1073741824)) GiB"

arch=$(docker info --format '{{.Architecture}}')
if [ "$arch" != "x86_64" ] && [ "${PROVER_DEV_OVERRIDE:-}" != "true" ]; then
  die "docker arch is $arch; the prover image is linux/amd64 only — set PROVER_DEV_OVERRIDE=true in chain/lineth/devnet.env"
fi
ok "arch $arch, prover mode ${WIZARD_PROVER:-dev}"

free_kb=$(docker run --rm alpine:3.20 df -k / 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$free_kb" ]; then
  [ "$free_kb" -ge 35000000 ] || warn "only $((free_kb/1048576)) GiB free inside the docker VM; the stack needs ~30 GiB (colima start --disk 60)"
  ok "docker VM free disk $((free_kb/1048576)) GiB"
fi

# Port check only for a cold start: a partially running stack (e.g. the local L1 from an earlier attempt)
# legitimately holds its ports and the upstream start.sh reuses those containers.
running=$( [ -f "$STACK_DIR/.env" ] && compose --profile local-l1 --profile stack-partial-prover ps -q 2>/dev/null | wc -l | tr -d ' ' || echo 0)
if [ "${running:-0}" -gt 0 ]; then
  ok "stack partially running ($running containers); skipping the host-port check"
elif [ -x "$STACK_DIR/scripts/check-ports.sh" ]; then
  ( cd "$STACK_DIR" && LINETH_SKIP_BANNER=true ./scripts/check-ports.sh ) || die "host ports busy (see above)"
  ok "host ports free"
fi
ok "preflight passed"
