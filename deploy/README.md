# acs-backend — Deploy Runbook

Migrated 2026-08-17 from kylevps (Genesis, amd64) to **morpheus** (NVIDIA GB10,
`linux/arm64`, Tailscale-only) + a public API proxy stub on **snswserver**
(Debian 13, `linux/amd64`, public IP). Mirrors the pattern already proven by
`morpheustools` and `cfodashboard`, except ACS's API has no same-stack
frontend to proxy through — it's hit directly by external clients — so it
needs its own dedicated reverse-proxy stub rather than piggybacking on a
Next.js server.

```
DNS: api.communityservices.org.au, staging-api.communityservices.org.au
        │
        ▼
  snswserver (107.155.65.229) — shared nginx-proxy + acme-companion
        │
  acs-api-proxy (this repo's deploy/docker-compose.snswserver.yml)
        │ proxy_pass, over Tailscale
        ▼
  morpheus (100.87.6.30)
    ├── acs-backend          :5000  (deploy/docker-compose.morpheus.yml)
    └── acs-backend-staging  :5050  (deploy/docker-compose-staging.morpheus.yml)
        │
        ▼
  host mongod (TLS, shared with cfodashboard/morpheustools) — databases
  `adventistcommunityservices` / `adventistcommunityservices-staging`
```

## One-time morpheus setup

SSH in as `morpheus@100.87.6.30`. `docker` needs no sudo; `sudo` itself needs
a password.

```bash
mkdir -p /home/morpheus/adventist-community-services /home/morpheus/adventist-community-services-staging
cp deploy/.env.backend.example /home/morpheus/adventist-community-services/.env.backend
cp deploy/.env.backend.example /home/morpheus/adventist-community-services-staging/.env.backend
chmod 600 /home/morpheus/adventist-community-services/.env.backend /home/morpheus/adventist-community-services-staging/.env.backend
```

Fill in real secrets per the comments in `.env.backend.example` (Wasabi,
email, JWT, Google — carried over from the old kylevps deployment; Mongo
password is the existing `adminbem` credential already used on this host).
**Staging's file needs `ADMIN_URL`/`FRONTEND_URL` pointed at
`staging-admin.communityservices.org.au` and `EXTRA_CORS_ORIGINS` covering
both staging hostnames** — see the inline comments.

GHCR access: CI logs in with the run's own `GITHUB_TOKEN` on every deploy —
no manual PAT needed. Requires morpheus's self-hosted Actions runner (label
`morpheus`) to be online; it predates this migration (shared with
morpheustools).

## One-time snswserver setup

```bash
mkdir -p /opt/acs-api-proxy
```

Nothing else to fill in — the proxy stub has no secrets, just the nginx
config CI syncs on every deploy. Needs repo secret `SNSW_SSH_KEY` (private key
authorized for `snswcomms@107.155.65.229`) and joins the box's existing
`proxy-network` (owned by `/opt/adventistpulse/proxy`, shared with every other
app on the host).

## DNS

- `api.communityservices.org.au` — repoint from kylevps (76.13.176.13) to
  snswserver's public IP (107.155.65.229).
- `staging-api.communityservices.org.au` — new A record, same target.

## Verification

```bash
# On morpheus:
curl -fsS http://127.0.0.1:5000/health
curl -fsS http://127.0.0.1:5050/health

# Public, after DNS cutover:
curl -I https://api.communityservices.org.au/health
curl -I https://staging-api.communityservices.org.au/health
```

## Rollback

Every build pushes an immutable `:<sha>` tag. On morpheus:

```bash
cd /home/morpheus/adventist-community-services   # or -staging
echo "IMAGE_TAG=<previous-good-sha>" >> .env
docker compose pull && docker compose up -d
```
