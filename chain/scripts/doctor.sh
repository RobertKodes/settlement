#!/usr/bin/env bash
# make doctor — toolchain check with fix hints. Exit 1 if anything required is missing.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fail=0
check() { # check <label> <ok:0|1> <found> <hint>
  if [ "$2" = 0 ]; then ok "$1: $3"; else printf '%s[fail]%s %s: %s\n    fix: %s\n' "$c_red" "$c_off" "$1" "$3" "$4" >&2; fail=1; fi
}
v=$(docker --version 2>/dev/null | sed -E 's/.*version ([0-9.]+).*/\1/'); check "docker >= 24" "$( [ -n "$v" ] && version_ge "$v" 24 && echo 0 || echo 1)" "${v:-missing}" "brew install docker colima"
v=$(docker compose version --short 2>/dev/null); check "docker compose >= 2.19" "$( [ -n "$v" ] && version_ge "$v" 2.19 && echo 0 || echo 1)" "${v:-missing}" "brew install docker-compose && mkdir -p ~/.docker/cli-plugins && ln -sfn \$(brew --prefix)/opt/docker-compose/bin/docker-compose ~/.docker/cli-plugins/docker-compose"
if docker info >/dev/null 2>&1; then
  mem=$(docker info --format '{{.MemTotal}}'); check "docker daemon (>= 8 GiB)" "$( [ "$mem" -ge 8000000000 ] && echo 0 || echo 1)" "$((mem/1073741824)) GiB, $(docker info --format '{{.Architecture}}')" "colima start --cpu 6 --memory 12"
else
  check "docker daemon" 1 "not running" "colima start --cpu 6 --memory 12"
fi
v=$(node --version 2>/dev/null | tr -d v); check "node >= 22" "$( [ -n "$v" ] && version_ge "$v" 22 && echo 0 || echo 1)" "${v:-missing}" "brew install node@22"
v=$(pnpm --version 2>/dev/null); check "pnpm >= 9" "$( [ -n "$v" ] && version_ge "$v" 9 && echo 0 || echo 1)" "${v:-missing}" "corepack enable && corepack prepare pnpm@9.15.9 --activate"
v=$(forge --version 2>/dev/null | head -1 | sed -E 's/.*Version: *([^ ]+).*/\1/;s/^forge //'); check "forge" "$( [ -n "$v" ] && echo 0 || echo 1)" "${v:-missing}" "curl -L https://foundry.paradigm.xyz | bash && foundryup"
v=$(git --version | awk '{print $3}'); check "git" 0 "$v" ""
v=$(make --version | head -1 | awk '{print $3}'); check "make >= 3.81" "$(version_ge "$v" 3.81 && echo 0 || echo 1)" "$v" "brew install make"
check "curl" "$(command -v curl >/dev/null && echo 0 || echo 1)" "$(command -v curl || echo missing)" "brew install curl"
[ "$fail" = 0 ] && ok "toolchain complete" || die "toolchain incomplete"
