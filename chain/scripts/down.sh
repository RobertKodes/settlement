#!/usr/bin/env bash
# make devnet-down — stop containers, keep containers + volumes so `make devnet-up` resumes the same chain.
# (`docker compose down` would remove the containers and the upstream start.sh always re-genesises.)
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_upstream
[ -f "$STACK_DIR/.env" ] || { warn "nothing to stop (no .env)"; exit 0; }
svcs=$(running_services)
if [ -z "$svcs" ]; then warn "no running stack containers"; exit 0; fi
printf '%s\n' "$svcs" > "$RESUME_FILE"
compose_all stop
ok "devnet stopped; $(printf '%s\n' "$svcs" | wc -l | tr -d ' ') services recorded for resume (make devnet-reset to wipe)"
