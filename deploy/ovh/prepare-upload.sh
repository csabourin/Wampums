#!/usr/bin/env bash
# Check the destination before transferring the large Docker archive.
set -euo pipefail
umask 077

root="${WAMPUMS_ROOT:-/opt/wampums}"
revision="${1:-}"
archive_bytes="${2:-}"
if [[ "$root" != /* || ! "$revision" =~ ^[a-f0-9]{40}$ || ! "$archive_bytes" =~ ^[1-9][0-9]*$ ]]; then
  echo 'Usage: prepare-upload.sh <40-character commit SHA> <archive bytes>' >&2
  exit 1
fi

release="$root/releases/$revision"
mkdir -p -- "$release"
df -h -- "$release"
df -i -- "$release"
if [[ ! -w "$release" || ( -e "$release/image.tar.gz" && ! -w "$release/image.tar.gz" ) ]]; then
  echo 'Release directory or existing image archive is not writable by the deployment account.' >&2
  exit 1
fi
# A real write also detects read-only mounts, exhausted inodes and some quotas.
probe="$(mktemp "$release/.upload-check.XXXXXX")"
trap 'rm -f -- "$probe"' EXIT
printf 'upload check\n' > "$probe"
readonly bytes_per_kib=1024
available_kib="$(LC_ALL=C df -Pk -- "$release" | awk 'END { print $4 }')"
if (( available_kib * bytes_per_kib < archive_bytes )); then
  echo "Insufficient space for upload: need $archive_bytes bytes; available $((available_kib * bytes_per_kib)) bytes. Docker loading needs additional space." >&2
  exit 1
fi
