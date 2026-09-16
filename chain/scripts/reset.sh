#!/usr/bin/env bash
# make devnet-reset — stop and wipe volumes + generated artifacts. Required after a chain-ID change.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_upstream
if [ -f "$STACK_DIR/.env" ]; then
  compose --profile local-l1 --profile stack-partial-prover down -v --remove-orphans || true
fi
if [ -x "$STACK_DIR/scripts/reset.sh" ]; then
  ( cd "$STACK_DIR" && LINETH_SKIP_BANNER=1 ./scripts/reset.sh --forget-deployer ) || true
fi
rm -rf "$STACK_DIR/artifacts" "$STACK_DIR/lineth-output" "$STACK_DIR/.env" "$RESUME_FILE"
ok "devnet reset (volumes, artifacts and .env removed)"
