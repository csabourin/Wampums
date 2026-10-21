#!/usr/bin/env bash
# Run as root on the inspected Ubuntu VPS, before uploading runtime secrets.
set -Eeuo pipefail
readonly app_root=/opt/wampums
readonly deploy_user=wampums-deploy

test "$(id -u)" -eq 0
. /etc/os-release
test "$ID" = ubuntu

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if ! id "$deploy_user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$deploy_user"
fi
usermod -aG docker "$deploy_user"
install -d -m 0750 -o "$deploy_user" -g "$deploy_user" "$app_root" "$app_root/releases" "$app_root/backups"
install -d -m 0700 -o "$deploy_user" -g "$deploy_user" "/home/$deploy_user/.ssh"

# Allow SSH before enabling the firewall. Containers publish only HTTP/HTTPS.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
docker version --format '{{.Server.Version}}'
docker compose version
ufw status
