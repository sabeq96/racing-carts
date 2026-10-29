#!/usr/bin/env bash
# Builds the controller and the game into one GitHub Pages site under output/.
#   output/              the game
#   output/controller/   the controller (CONTROLLER_URL points here; players reach it by QR code)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/output"

npm run build -w controller
npm run build -w game

rm -rf "$OUT"
mkdir -p "$OUT/controller"
cp -R "$ROOT/apps/game/dist/." "$OUT/"
cp -R "$ROOT/apps/controller/dist/." "$OUT/controller/"
# Tizen-only files have no place on the web.
rm -f "$OUT/config.xml" "$OUT"/*.wgt
# Serve files as-is; no Jekyll processing.
touch "$OUT/.nojekyll"

echo "Web build ready: $OUT"
