#!/usr/bin/env bash
# Shared helpers for chain/scripts/*.sh. Source, do not execute.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LINETH_DIR="$REPO_ROOT/chain/lineth"
UPSTREAM_DIR="$LINETH_DIR/upstream"
STACK_DIR="$UPSTREAM_DIR/docs/getting-started/lineth-stack"
DEVNET_ENV="$LINETH_DIR/devnet.env"
# Written by down.sh (services that were running), consumed by up.sh to resume without re-genesis.
RESUME_FILE="$LINETH_DIR/.resume-services"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/LFDT-Lineth/lineth-monorepo.git}"

# Expose the same PATH the Makefile assumes (foundryup installs outside the default PATH).
export PATH="$HOME/.foundry/bin:$PATH"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_cyn=$'\033[36m'; c_off=$'\033[0m'
info() { printf '%s[devnet]%s %s\n' "$c_cyn" "$c_off" "$*"; }
ok()   { printf '%s[ ok ]%s %s\n' "$c_grn" "$c_off" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$c_yel" "$c_off" "$*" >&2; }
die()  { printf '%s[fail]%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1${2:+ — $2}"
}

# version_ge 2.19.0 2.19  -> true if $1 >= $2 (dotted numeric)
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Load devnet.env into the current shell (exported).
load_devnet_env() {
  [ -f "$DEVNET_ENV" ] || die "missing $DEVNET_ENV"
  set -a; # shellcheck disable=SC1090
  . "$DEVNET_ENV"; set +a
}

upstream_commit() { tr -d '[:space:]' < "$LINETH_DIR/UPSTREAM_COMMIT"; }

require_upstream() {
  [ -d "$STACK_DIR" ] || die "upstream not vendored — run: make devnet-bootstrap"
}

# rpc <url> <method> [params-json]  -> prints the JSON "result" (scalars raw, objects as JSON), empty on failure.
# python3 rather than sed: macOS ships BSD sed, whose basic regex has no alternation.
rpc() {
  local url="$1" method="$2" params="${3:-[]}"
  curl -sS -m 5 -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}" "$url" 2>/dev/null \
    | python3 -c 'import json,sys
try:
    r = json.load(sys.stdin).get("result")
except Exception:
    r = None
if r is None: sys.exit(0)
print(r if isinstance(r, str) else json.dumps(r))' 2>/dev/null
}

hex2dec() { case "${1:-}" in 0x[0-9a-fA-F]*) printf '%d\n' "$1" 2>/dev/null || echo 0 ;; *) echo 0 ;; esac; }

# Local overlay on the vendored tree (idempotent). Upstream at the pinned commit pins pnpm 11.9, whose
# default policies break its own quickstart containers: `pnpm exec` re-runs a full install
# (verifyDepsBeforeRun) and that install refuses the git-sourced sub-dependency of @chainlink/contracts
# (blockExoticSubdeps). pnpm 11 reads these only from pnpm-workspace.yaml, which is bind-mounted into
# the containers, so the overlay has to live in the vendored file. Remove when upstream ships the fix.
apply_upstream_overlay() {
  local f="$UPSTREAM_DIR/pnpm-workspace.yaml" marker="# --- local devnet overlay (chain/scripts/lib.sh) ---"
  [ -f "$f" ] || die "missing $f (run make devnet-bootstrap)"
  if ! grep -qF "$marker" "$f"; then
    printf '\n%s\nblockExoticSubdeps: false\nverifyDepsBeforeRun: false\n' "$marker" >> "$f"
    ok "applied pnpm overlay to upstream/pnpm-workspace.yaml"
  fi
}

compose() {
  # The quickstart expects to be run from its own directory with both env files.
  ( cd "$STACK_DIR" && docker compose --env-file versions.env --env-file .env "$@" )
}
# Same, with every stack profile selected (needed for ps/stop/start to see all containers).
compose_all() { compose --profile local-l1 --profile stack-partial-prover "$@"; }

# Long-running services currently up (one-shot jobs are already exited and are not restarted on resume).
running_services() { compose_all ps --status running --format '{{.Service}}' 2>/dev/null | sort -u; }
