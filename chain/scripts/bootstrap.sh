#!/usr/bin/env bash
# make devnet-bootstrap — sparse, shallow, pinned checkout of the Lineth monorepo into chain/lineth/upstream.
# Idempotent: re-running verifies the pin and refreshes the sparse path list.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_cmd git
pin="$(upstream_commit)"
[ ${#pin} -eq 40 ] || die "UPSTREAM_COMMIT must be a full 40-char SHA, got '$pin'"
paths=$(grep -vE '^\s*(#|$)' "$LINETH_DIR/UPSTREAM_SPARSE_PATHS")

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  info "cloning $UPSTREAM_REPO @ $pin (sparse: $(echo $paths | tr '\n' ' '))"
  mkdir -p "$UPSTREAM_DIR"
  git -C "$UPSTREAM_DIR" init -q
  git -C "$UPSTREAM_DIR" remote add origin "$UPSTREAM_REPO"
  git -C "$UPSTREAM_DIR" config advice.detachedHead false
  # Cone mode: the listed directories recursively, plus every file at the root and in their parent
  # directories. The root files matter: the quickstart's account-setup container runs `pnpm install`
  # against the monorepo root (package.json, pnpm-workspace.yaml catalog, pnpm-lock.yaml, .npmrc).
  # shellcheck disable=SC2086
  git -C "$UPSTREAM_DIR" sparse-checkout set --cone $paths
  git -C "$UPSTREAM_DIR" fetch -q --depth 1 origin "$pin"
  git -C "$UPSTREAM_DIR" checkout -q FETCH_HEAD
else
  # shellcheck disable=SC2086
  git -C "$UPSTREAM_DIR" sparse-checkout set --cone $paths
  head=$(git -C "$UPSTREAM_DIR" rev-parse HEAD)
  if [ "$head" != "$pin" ]; then
    info "upstream at $head, pin is $pin — fetching pin"
    git -C "$UPSTREAM_DIR" fetch -q --depth 1 origin "$pin"
    git -C "$UPSTREAM_DIR" checkout -q FETCH_HEAD
  fi
fi

head=$(git -C "$UPSTREAM_DIR" rev-parse HEAD)
[ "$head" = "$pin" ] || die "checked-out HEAD $head != pin $pin"
[ -f "$STACK_DIR/scripts/start.sh" ] || die "quickstart missing after checkout: $STACK_DIR/scripts/start.sh"
chmod +x "$STACK_DIR"/scripts/*.sh 2>/dev/null || true
apply_upstream_overlay

# Chain-ID consistency check across the three files that must agree (chain/lineth/README.md).
load_devnet_env
g1=$(sed -n 's/.*"chainId": *\([0-9]*\).*/\1/p' "$UPSTREAM_DIR/docker/config/l2-genesis-initialization/genesis-besu.json.template" | head -1)
g2=$(sed -n 's/.*"chainId": *\([0-9]*\).*/\1/p' "$UPSTREAM_DIR/docker/config/l2-genesis-initialization/genesis-maru.json.template" | head -1)
g3=$(sed -n 's/^ *chain_id *= *\([0-9]*\).*/\1/p' "$UPSTREAM_DIR/docker/config/prover/v3/prover-config.toml" | head -1)
if [ "$g1" = "$L2_CHAIN_ID" ] && [ "$g2" = "$L2_CHAIN_ID" ] && [ "$g3" = "$L2_CHAIN_ID" ]; then
  ok "L2 chain ID $L2_CHAIN_ID agrees across genesis-besu, genesis-maru, prover-config"
else
  warn "L2 chain ID mismatch: devnet.env=$L2_CHAIN_ID besu=$g1 maru=$g2 prover=$g3 (see chain/lineth/README.md)"
fi
ok "upstream vendored at $pin ($(du -sh "$UPSTREAM_DIR" | cut -f1))"
