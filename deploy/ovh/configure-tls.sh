#!/usr/bin/env bash
# Issue certificates with DNS validation before moving application DNS records.
set -Eeuo pipefail
readonly token_file="${1:-/home/ubuntu/.wampums-cloudflare-token}"
readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly propagation_seconds=30
test "$(id -u)" -eq 0
test -s "$token_file"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y certbot python3-certbot-dns-cloudflare
install -d -m 0700 /etc/letsencrypt
python3 - "$token_file" <<'PY'
import sys
from pathlib import Path
token = Path(sys.argv[1]).read_text().strip()
credentials = Path('/etc/letsencrypt/cloudflare.ini')
credentials.touch(mode=0o600, exist_ok=True)
credentials.chmod(0o600)
credentials.write_text('dns_cloudflare_api_token = ' + token + '\n')
PY
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "$script_dir/certbot-deploy-hook.sh" /etc/letsencrypt/renewal-hooks/deploy/wampums-caddy.sh
certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  --dns-cloudflare-propagation-seconds "$propagation_seconds" \
  --cert-name wampums --keep-until-expiring \
  -d wampums.app -d '*.wampums.app' -d meute6a.app -d '*.meute6a.app'
/etc/letsencrypt/renewal-hooks/deploy/wampums-caddy.sh
systemctl enable --now certbot.timer
openssl x509 -in /opt/wampums/tls/fullchain.pem -noout -dates -issuer
