#!/usr/bin/env bash
# make adr-new NAME="short-title" — copies the template with the next free number.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "${1:-}" ] || { echo "usage: make adr-new NAME=\"short-title\""; exit 1; }
slug=$(echo "$1" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')
last=$(ls "$DIR" | sed -n 's/^\([0-9]\{4\}\)-.*\.md$/\1/p' | sort -n | tail -1)
next=$(printf '%04d' $((10#$last + 1)))
f="$DIR/$next-$slug.md"
sed "s/ADR-NNNN: <title>/ADR-$next: $1/; s/YYYY-MM-DD/$(date +%F)/" "$DIR/0000-template.md" > "$f"
echo "$f"
echo "add it to docs/adr/README.md"
