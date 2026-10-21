#!/usr/bin/env bash
# Certbot calls this after a successful renewal; Caddy reads only copied PEMs.
set -Eeuo pipefail
readonly lineage="${RENEWED_LINEAGE:-/etc/letsencrypt/live/wampums}"
readonly tls_dir="${WAMPUMS_TLS_DIR:-/opt/wampums/tls}"
install -d -m 0750 "$tls_dir"
install -m 0644 "$lineage/fullchain.pem" "$tls_dir/fullchain.pem.next"
install -m 0600 "$lineage/privkey.pem" "$tls_dir/privkey.pem.next"
mv -f "$tls_dir/fullchain.pem.next" "$tls_dir/fullchain.pem"
mv -f "$tls_dir/privkey.pem.next" "$tls_dir/privkey.pem"
if [[ -n "$(docker ps --filter 'name=^/wampums-caddy-1$' --filter status=running --format '{{.ID}}')" ]]; then
  docker exec wampums-caddy-1 caddy reload --config /etc/caddy/Caddyfile
fi
