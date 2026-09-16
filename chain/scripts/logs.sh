#!/usr/bin/env bash
# make devnet-logs [SERVICE=x] — follow compose logs.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_upstream
compose logs -f --tail=200 "$@"
