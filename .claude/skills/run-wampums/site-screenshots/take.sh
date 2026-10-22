#!/usr/bin/env bash
# Retake the app screenshots shown on wampums.app (landing/images/screenshots).
#   .claude/skills/run-wampums/site-screenshots/take.sh [name ...]
# With no names, all 14 screens in both languages; otherwise only those named
# (dashboard, attendance, points, badges, announcement, budget, fees, forms,
# inventory, carpool, fundraiser, medications, offline, parent).
# Uses its own database and cache, so the usual run-wampums unit is untouched.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
HERE=.claude/skills/run-wampums/site-screenshots
SKILL=.claude/skills/run-wampums
OUT=landing/images/screenshots
# The site's images were saved at this WebP quality; keep it so sizes stay comparable.
QUALITY=0.82

export WAMPUMS_RUN_CACHE="${WAMPUMS_RUN_CACHE:-$HOME/.cache/wampums-run/showcase}"
export WAMPUMS_RUN_DB="${WAMPUMS_RUN_DB:-wampums_showcase}"
WORK="$WAMPUMS_RUN_CACHE/site-screenshots"
mkdir -p "$WAMPUMS_RUN_CACHE/logs"

"$SKILL/stop.sh" >/dev/null
"$SKILL/db.sh" > "$WAMPUMS_RUN_CACHE/logs/db.log" 2>&1
node "$SKILL/seed.mjs" > "$WAMPUMS_RUN_CACHE/logs/seed.log"
node "$HERE/showcase.cjs" "$WAMPUMS_RUN_CACHE/seed.json"
"$SKILL/start.sh" >/dev/null
trap '"$SKILL/stop.sh" >/dev/null' EXIT

rm -rf "$WORK" && mkdir -p "$WORK/png" "$WORK/webp"
node "$HERE/capture.cjs" "$WORK/png" "$WAMPUMS_RUN_CACHE/seed.json" "$@"
node "$HERE/towebp.cjs" "$WORK/png" "$WORK/webp" "$QUALITY"
cp "$WORK"/webp/*.webp "$OUT/"
echo "Wrote $(ls "$WORK"/webp | wc -l) screenshots to $OUT -- open them and look before committing."
