#!/usr/bin/env bash
# Recreate the app container from the active release, so it rereads app.env.
# `docker restart` would keep the environment the container was created with.
# Installed on the VPS as /usr/local/bin/wampums-restart; run it with sudo.
set -Eeuo pipefail

root="${WAMPUMS_ROOT:-/opt/wampums}"
readonly wait_timeout=180

# Same lock as deploy.sh, taken before reading the release: a deployment that
# finished in between would otherwise be replaced by the image it superseded.
{ exec 9>"$root/deploy.lock"; } 2>/dev/null || { echo "Cannot open $root/deploy.lock (run with sudo?)" >&2; exit 1; }
flock -n 9 || { echo 'A deployment is running; try again once it finishes' >&2; exit 1; }

release_dir="$(readlink -f "$root/current" 2>/dev/null || true)"
image="$(cat "$root/current-image" 2>/dev/null || true)"
if [[ ! "$image" =~ ^wampums:[a-f0-9]{40}$ ]] || [[ ! -f "$release_dir/compose.yml" ]]; then
  echo "No active release under $root" >&2
  exit 1
fi

export WAMPUMS_ROOT="$root"
export WAMPUMS_IMAGE="$image"
docker compose --project-name wampums --env-file "$root/.env" -f "$release_dir/compose.yml" \
  up -d --no-deps --force-recreate --wait --wait-timeout "$wait_timeout" app
echo "Restarted $image"
