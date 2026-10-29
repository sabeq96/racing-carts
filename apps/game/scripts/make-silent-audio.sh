#!/usr/bin/env bash
# Writes silent placeholder mp3s into apps/game/public/audio/ so the game can load every sound.
# Replace a file with the real recording under the same name (see docs/audio-assets.md).
# Keep the name lists in sync with src/audio/manifest.ts (manifest.test.ts fails if they drift).
# Usage: bash apps/game/scripts/make-silent-audio.sh
set -euo pipefail

OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/public/audio"
mkdir -p "$OUT"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg is not on your PATH." >&2
  exit 1
fi

# make <name> <seconds>
make() {
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i anullsrc=r=44100:cl=mono -t "$2" -q:a 9 "$OUT/$1.mp3"
}

for name in music_lobby music_race; do make "$name" 2; done
make engine_loop 1
for name in countdown_beep countdown_go item_box_pickup item_roulette boost shield_up shield_break \
  mine_drop mine_explode rocket_fire rocket_explode kart_spinout wall_bump kart_bump \
  lap_complete final_lap race_finish player_join; do
  make "$name" 0.3
done
echo "Wrote $(ls -1 "$OUT"/*.mp3 | wc -l) placeholder files to $OUT"
