#!/usr/bin/env bash
# One-time setup for driving Wampums in a headless browser.
#
# Everything goes to a cache outside the repo ($WAMPUMS_RUN_CACHE, default
# ~/.cache/wampums-run): the repo's .gitignore only ignores the root
# node_modules/, so installing inside the skill directory would get committed.
set -euo pipefail

CACHE="${WAMPUMS_RUN_CACHE:-$HOME/.cache/wampums-run}"
PLAYWRIGHT_VERSION="1.56.1"
mkdir -p "$CACHE"

# playwright-core only: no bundled browsers, no test runner, no project deps.
if [ ! -f "$CACHE/node_modules/playwright-core/package.json" ]; then
  npm install --silent --no-save --prefix "$CACHE" "playwright-core@$PLAYWRIGHT_VERSION"
fi
echo "playwright-core $(node -p "require('$CACHE/node_modules/playwright-core/package.json').version")"

# The headless Chromium build that matches this playwright-core version.
node "$CACHE/node_modules/playwright-core/cli.js" install chromium-headless-shell

# The headless shell links libasound.so.2, which a minimal Ubuntu lacks. Unpack
# it into the cache instead of installing system packages (no sudo needed).
SHELL_BIN="$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell | sort -V | tail -1)"
if ldd "$SHELL_BIN" | grep -q "libasound.so.2 => not found"; then
  mkdir -p "$CACHE/libs" && cd "$CACHE/libs"
  apt-get download libasound2t64 >/dev/null 2>&1 || apt-get download libasound2 >/dev/null 2>&1
  for deb in *.deb; do dpkg -x "$deb" root; done
  cd - >/dev/null
fi
LD_LIBRARY_PATH="$CACHE/libs/root/usr/lib/x86_64-linux-gnu" ldd "$SHELL_BIN" | grep "not found" \
  && { echo "Chromium still has missing libraries (above)"; exit 1; } || true
echo "headless shell ready: $SHELL_BIN"
