#!/usr/bin/env bash
# Recreate the app container from the active release, so it rereads app.env.
# `docker restart` would keep the environment the container was created with.
# Installed on the VPS as /usr/local/bin/wampums-restart; run it with sudo.
set -Eeuo pipefail

root="${WAMPUMS_ROOT:-/opt/wampums}"
readonly wait_timeout=180

release_dir="$(readlink -f "$root/current" 2>/dev/null || true)"
image="$(cat "$root/current-image" 2>/dev/null || true)"
if [[ ! "$image" =~ ^wampums:[a-f0-9]{40}$ ]] || [[ ! -f "$release_dir/compose.yml" ]]; then
  echo "No active release under $root (run with sudo?)" >&2
  exit 1
fi

# Same lock as deploy.sh: never restart in the middle of a deployment.
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'A deployment is running; try again once it finishes' >&2; exit 1; }

export WAMPUMS_ROOT="$root"
export WAMPUMS_IMAGE="$image"
docker compose --project-name wampums --env-file "$root/.env" -f "$release_dir/compose.yml" \
  up -d --no-deps --force-recreate --wait --wait-timeout "$wait_timeout" app
echo "Restarted $image"
