#!/usr/bin/env bash
# Packages apps/game/dist into a signed Tizen .wgt.
# Usage: bash apps/game/scripts/package-tizen.sh [certificate-profile]   (default: RacingCarts)
set -euo pipefail

PROFILE="${1:-RacingCarts}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DIST="$ROOT/apps/game/dist"

if ! command -v tizen >/dev/null 2>&1; then
  echo "error: the 'tizen' CLI is not on your PATH." >&2
  echo "Install Tizen Studio and see docs/tizen-sideload.md for setup." >&2
  exit 1
fi

if [ ! -f "$DIST/config.xml" ]; then
  echo "error: $DIST/config.xml not found. Run 'npm run build -w game' first." >&2
  exit 1
fi

rm -f "$DIST"/*.wgt
tizen package -t wgt -s "$PROFILE" -- "$DIST"

WGT="$(ls -1 "$DIST"/*.wgt 2>/dev/null | head -n 1 || true)"
if [ -z "$WGT" ]; then
  echo "error: tizen package finished but no .wgt was found in $DIST." >&2
  exit 1
fi
# The CLI names the file after the app; normalise so docs can rely on one name.
if [ "$WGT" != "$DIST/RacingCarts.wgt" ]; then
  mv "$WGT" "$DIST/RacingCarts.wgt"
  WGT="$DIST/RacingCarts.wgt"
fi
echo "Packaged: $WGT"
