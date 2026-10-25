#!/usr/bin/env bash
# Activate a previously uploaded release; serialize manual and CI deployments.
set -Eeuo pipefail
umask 077

release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="${WAMPUMS_ROOT:-/opt/wampums}"
revision="${1:-}"
readonly wait_timeout=180

if [[ ! "$revision" =~ ^[a-f0-9]{40}$ ]] || [[ "$root" != /* ]]; then
  echo 'Usage: WAMPUMS_ROOT=/absolute/path bash deploy.sh <40-character commit SHA>' >&2
  exit 1
fi
export WAMPUMS_ROOT="$root"
export WAMPUMS_IMAGE="wampums:$revision"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is running' >&2; exit 1; }
test -s "$root/app.env"
test -s "$root/.env"
previous_images="${WAMPUMS_PREVIOUS_IMAGES:-3}"
if [[ -f "$root/image-retention" ]]; then
  previous_images="$(cat "$root/image-retention")"
fi
if [[ ! "$previous_images" =~ ^[1-9][0-9]*$ ]]; then
  echo 'Image retention must be a positive number of previous images.' >&2
  exit 1
fi

compose=(docker compose --project-name wampums --env-file "$root/.env" -f "$release_dir/compose.yml")
previous_dir="$(readlink -f "$root/current" 2>/dev/null || true)"
previous_image="$(cat "$root/current-image" 2>/dev/null || true)"
app_stopped=false

rollback() {
  local result=$?
  trap - ERR
  echo 'Deployment failed; attempting to restore the previous application image.' >&2
  if [[ "$app_stopped" == true && -n "$previous_image" && -f "$previous_dir/compose.yml" ]]; then
    WAMPUMS_IMAGE="$previous_image" docker compose --project-name wampums \
      --env-file "$root/.env" -f "$previous_dir/compose.yml" up -d --no-deps --wait \
      --wait-timeout "$wait_timeout" app caddy || echo 'Application recovery failed; operator action required.' >&2
  elif [[ "$app_stopped" == true ]]; then
    "${compose[@]}" stop app || true
  fi
  echo 'Database migrations are not reversed automatically.' >&2
  exit "$result"
}
trap rollback ERR

# Keep the active image, its immediate predecessor and the newest remaining
# commit images up to the retention limit. Never force removal of an image.
prune_images() {
  local images image kept=0 result=0
  images="$(docker image ls wampums --format '{{.Repository}}:{{.Tag}}')" || return 1
  if [[ "$previous_image" =~ ^wampums:[a-f0-9]{40}$ && "$previous_image" != "$WAMPUMS_IMAGE" ]]; then
    kept=1
  fi
  while IFS= read -r image; do
    [[ "$image" =~ ^wampums:[a-f0-9]{40}$ ]] || continue
    [[ "$image" != "$WAMPUMS_IMAGE" && "$image" != "$previous_image" ]] || continue
    if (( kept < previous_images )); then
      kept=$((kept + 1))
    elif ! docker image rm "$image"; then
      echo "Could not remove old image $image; retained for operator review." >&2
      result=1
    fi
  done <<< "$images"
  return "$result"
}

docker load --input "$release_dir/image.tar.gz"
# The loaded Docker image is sufficient for activation and rollback.
rm -- "$release_dir/image.tar.gz"
# Stop background workers before migration to avoid simultaneous messaging sessions.
app_stopped=true
"${compose[@]}" stop app
"${compose[@]}" run --rm --no-deps app npm run db:migrate:deploy
"${compose[@]}" up -d --no-deps --wait --wait-timeout "$wait_timeout" app
"${compose[@]}" up -d --no-deps --wait --wait-timeout "$wait_timeout" caddy
printf '%s\n' "$WAMPUMS_IMAGE" > "$root/current-image.next"
mv -f "$root/current-image.next" "$root/current-image"
ln -sfn "$release_dir" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
# The release is committed. Maintenance failure must not trigger a rollback.
trap - ERR
if ! prune_images; then
  echo 'Release is active, but image cleanup was incomplete.' >&2
fi
echo "Deployed $revision"
