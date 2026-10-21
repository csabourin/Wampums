# OVH installation and continuous deployment

This stack runs one application instance and Caddy on an existing Linux VPS.
Caddy terminates HTTPS and proxies HTTP and Socket.IO to the app. PostgreSQL 18
and Garage S3 storage have no published production ports. Runtime credentials stay on the VPS; the
GitHub runner receives only a dedicated SSH deployment key. Images are built in
GitHub Actions and transferred over verified SSH, so no registry token or GitHub
checkout is needed on the VPS. Docker Compose 2.30+ is required (`env_file.format`).

## Status and information needed

As of 2026-10-21, the blank OVH VPS at `148.113.174.196` has Docker, Compose,
firewall rules and the `wampums-deploy` account installed. The admin login is
`ubuntu`. Its ED25519 host-key fingerprint was verified through KVM. A snapshot
of production has been restored into PostgreSQL 18; current main
`456dc8cac713980d36c95e9770a9646f82c2761d` is running in an isolated validation
stack under `/opt/wampums/validation`. No public DNS records were changed.
The GitHub environment and deployment credentials are configured, and the
repository variable `OVH_DEPLOY_ENABLED` is **false**.

The migration includes the app, PostgreSQL and files. The resolved production
database is Railway PostgreSQL 18.6 (about 32 MB). All 26 objects in the active
Railway S3 bucket (1,944,140 bytes) were copied to Garage and verified using
SHA-256. Five equipment photo references were already absent from the source
bucket; their old Supabase project is unavailable. Preserve those references
and obtain another backup if those photos need recovery.

## Test before changing DNS

Apply `compose.validation.yml` along with `compose.yml`. It makes the application,
database and Garage network internal, blocking external messaging, email and
payment connections. A separate proxy publishes only loopback ports for SSH
forwarding. Do not attach the app to the preview proxy's external network.

From the tester's computer:

```bash
ssh -N -L 8080:127.0.0.1:18080 -L 3900:127.0.0.1:13900 ubuntu@148.113.174.196
```

Open `http://localhost:8080`. Its default unit comes from the retained
`ORGANIZATION_ID`. Photos use `http://files.localhost:3900`; browsers resolve
`.localhost` names to loopback. Garage has the corresponding alias inside the
isolated Docker network. Test data is a copy: edits made here will not survive
the final production restore. Test login, main screens, uploads/downloads and
organization routing; outbound integrations stay blocked during this stage.

## Install on the VPS

1. Inspect existing services, firewall, storage and listening ports. Install
   Docker Engine and the Compose plugin using `provision.sh` (run as root after
   inspection). Reserve ports 80 and 443; allow SSH and HTTP/HTTPS in the OVH
   firewall and host firewall. Do not expose PostgreSQL or the app port.
2. Create a dedicated SSH deployment account and `/opt/wampums/releases`, owned
   by that account. Grant Docker access. Docker access grants administrative
   power over the VPS; use a key dedicated to this repository and server.
3. Create `/opt/wampums/.env`, mode 600, with:

   ```dotenv
   APP_DOMAINS=wampums.app,demo.wampums.app,meute6b.wampums.app,1stwilliamsburg.wampums.app,castors6h.wampums.app,mobile.meute6a.app,meute6a.app
   STORAGE_DOMAIN=files.wampums.app
   WAMPUMS_ROOT=/opt/wampums
   WAMPUMS_IMAGE=wampums:REPLACE_WITH_COMMIT_SHA
   ```

   For production, use the comma-separated set of all domains being moved.
   Before cutover, run `configure-tls.sh` as root with a private Cloudflare token
   file. Its token needs DNS Edit and Zone Read for both zones. It installs
   Certbot's Cloudflare DNS plugin, issues a certificate for both apex domains
   and their wildcards using temporary TXT records, and enables automatic
   renewal. Existing app DNS records can still point to Railway during issuance.
   The deployment hook copies only the certificate and key to `/opt/wampums/tls`
   and reloads Caddy after renewal; the API token remains outside the container.
   Keep `/etc/letsencrypt` and `/opt/wampums/tls` in the secure server backup.
   During validation use the real
   organization hostnames with a local hosts entry or `curl --resolve`; an
   arbitrary hostname is not automatically an organization in this app.
4. Copy resolved runtime variables from Railway securely into
   `/opt/wampums/app.env`, mode 600. Each line is `NAME=value`; raw env files
   preserve `$` and quote characters literally. Do not commit or print these
   files. Preserve JWT/session secrets, VAPID keys, Stripe, email, AI, receipt,
   storage and messaging credentials. Use the variable names the current app
   accepts, including `JWT_SECRET_KEY` (legacy deployments may use `JWT_SECRET`).
   Set `DATABASE_URL` to an endpoint reachable from OVH; Railway private names
   cannot be used there. Set `APP_URL` to the intended public HTTPS URL.
5. Choose the build-time public values `VITE_STRIPE_PUBLISHABLE_KEY` and
   `VITE_VAPID_PUBLIC` to match production. `VITE_API_URL` is intentionally absent
   so the browser uses its own origin. Never supply private keys as build args.

## Database and object migration

Before cutover, create a custom-format `pg_dump` and test restoring it into an
isolated database. Preserve roles/grants needed by the app separately. Check
extensions and PostgreSQL compatibility; the optional service uses PostgreSQL
18, so adjust its version to match the source before the first initialization
if necessary. Do not initialize an empty schema as a replacement for real data.

To use the optional VPS database, create `/opt/wampums/postgres.env` (mode 600):

```dotenv
POSTGRES_USER=wampums
POSTGRES_DB=wampums
POSTGRES_PASSWORD=REPLACE_WITH_GENERATED_PASSWORD
```

After uploading the release files and image, set `WAMPUMS_ROOT=/opt/wampums` and
`WAMPUMS_IMAGE=wampums:<commit SHA>` in the shell. Use the uploaded Compose file:

```bash
docker compose --env-file /opt/wampums/.env -f /opt/wampums/releases/<commit SHA>/compose.yml --profile database up -d --wait postgres
```

Restore the dump with the matching PostgreSQL tools. Set the app's
`DATABASE_URL=postgresql://wampums:URL_ENCODED_PASSWORD@postgres:5432/wampums` and
`DB_SSL_DISABLED=true` for this private Docker network. The latter is necessary
because the application otherwise requires TLS for non-loopback hosts. Do not
use it with a remote public database.

Copy S3 objects with an S3-aware transfer tool, preserve object keys, compare
counts and sizes, and test signed photo URLs. Change `AWS_*` credentials and
endpoint only after verifying the destination. Stable object keys generally
survive a move; old absolute URLs require validation. Keep existing bucket
access until every referenced object is accounted for.

For Garage, create `/opt/wampums/garage.toml` from `garage.toml.example`, replacing
both secret placeholders. Create a mode-600 `/opt/wampums/garage.env` containing
`GARAGE_DEFAULT_ACCESS_KEY` (`GK` followed by 32 random hex characters),
`GARAGE_DEFAULT_SECRET_KEY` (64 random hex characters), and
`GARAGE_DEFAULT_BUCKET` (the existing bucket name). Start the `storage` profile.
Use `AWS_ENDPOINT_URL=https://files.wampums.app`, `AWS_DEFAULT_REGION=garage`
and `AWS_S3_URL_STYLE=path` in the production app environment. The validation
override replaces only the endpoint. Garage has one data copy on this VPS;
off-server backups are required before retiring the source services.

Database-backed WhatsApp sessions and email workers must run on **one host**.
For final cutover, stop Railway app workers/writes, take and restore a final
database dump, finish the object delta copy, then start OVH. This requires a
maintenance window. Do not launch a second app against production merely to
preview it: startup restores background services automatically.

After the user validates the test copy, stop the validation stack with both
profiles enabled and `docker compose down` **without `-v`**. Recreate PostgreSQL
and Garage with the production Compose file, which recreates their network with
external access. Stop Railway writers before taking the final dump, refresh the
OVH database from that dump and repeat the object-copy verification. Start the
OVH app only after the source workers are stopped. Then update Cloudflare DNS
for the app hostnames and `files.wampums.app` to `148.113.174.196`, and verify
public HTTPS and all integrations. Until testing is approved, do not perform
these cutover steps or enable automatic deployment.

## First release and GitHub configuration

Build `Dockerfile.ovh` for the VPS architecture, tag it `wampums:<40-character
commit SHA>`, then upload a compressed `docker save` as `image.tar.gz`, alongside
`compose.yml`, `Caddyfile`, and `deploy.sh`, to
`/opt/wampums/releases/<commit SHA>/`. The automatic workflow currently builds
for the GitHub Ubuntu runner's x86-64 architecture; confirm the VPS matches.
Run `bash /opt/wampums/releases/<commit SHA>/deploy.sh <commit SHA>`.

Set up the GitHub environment **ovh-production** with:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `OVH_HOST` | Verified VPS hostname or IPv4 |
| Variable | `OVH_USER` | Dedicated deployment account |
| Variable | `OVH_SSH_PORT` | SSH port (default 22) |
| Variable | `VITE_STRIPE_PUBLISHABLE_KEY` | Current Stripe public key |
| Variable | `VITE_VAPID_PUBLIC` | Current push public key |
| Secret | `OVH_SSH_PRIVATE_KEY` | Dedicated deployment private key |
| Secret | `OVH_SSH_KNOWN_HOSTS` | Host-key entry verified against OVH console |

Do not trust an unauthenticated `ssh-keyscan` result without checking its
fingerprint. For a nonstandard SSH port use `[hostname]:port` in known_hosts.

After a successful manual installation and external verification, set the
**repository variable** `OVH_DEPLOY_ENABLED=true`. It must be repository scoped
because the job condition is evaluated before environment variables are loaded.
Every push to `main` (including merges) then deploys only if all three CI jobs
pass. Failed CI leaves the running app untouched. Main-branch CI runs and server
deployments are serialized to avoid interrupting migrations.

## Validation, backups and recovery

Check HTTPS, `/health`, login, organization routing on **each** domain, database
writes, equipment images, email, push, Stripe webhooks, Socket.IO and messaging.
The container health probe verifies HTTP readiness; migrations verify database
connectivity, but these do not replace the functional checks. Update DNS for
all seven current custom domains and any external webhook allowlists/settings.
Keep Railway available for recovery until those checks pass.

Deployments stop the old app, migrate transactionally, start the new app, and
wait for its health check. Expect brief downtime. If deployment fails, the
script attempts to start the previous image and Compose configuration. It does
**not** undo committed database migrations; changes must remain compatible with
the previous release or need an operator-led restore. Do not re-enable Railway
writes after OVH accepts writes without reconciling the data.

Schedule encrypted off-server PostgreSQL backups and object backups, define
retention, and test restores before relying on the VPS as the only copy. Also
preserve `/opt/wampums/*.env` securely. Docker volumes survive image updates but
are not backups. Retain previous release directories/images for recovery and
monitor disk usage; image pruning and backup deletion are intentionally manual.
Never run `docker compose down -v` on this stack.

Disable future automated deployments by setting `OVH_DEPLOY_ENABLED=false`;
this leaves the running application up. The source Railway deployment trigger
also needs disabling at cutover to prevent it restoring duplicate workers.

References: [Docker Compose in production](https://docs.docker.com/compose/how-tos/production/),
[GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use).
