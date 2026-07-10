# Production deployment

This guide covers running Nibleaf in production behind a TLS reverse proxy.
For local development see the [README](README.md); for upgrades and rollbacks
see [UPGRADING.md](UPGRADING.md).

> The container entrypoint **refuses to start** (`exit 1`) when `NODE_ENV=production`
> and `BETTER_AUTH_SECRET` is empty or left at a known demo default. Generate a real
> secret before your first deploy.

## 1. Choose your stack

| Path | File | When |
| --- | --- | --- |
| **Pull-based (recommended)** | [`docker-compose.prod.yml`](docker-compose.prod.yml) | Production. Pulls the prebuilt `ghcr.io/lord007tn/nibleaf` image pinned to a release tag — no build, runs on a small VPS. |
| Source build | [`docker-compose.yml`](docker-compose.yml) | You are modifying the code. ⚠ The in-container monorepo build needs **~5–6 GB free RAM** and OOMs small servers. |
| Coolify | [`docker-compose.coolify.yml`](docker-compose.coolify.yml) | You run [Coolify](https://coolify.io); it manages domains/TLS and generates the `SERVICE_*` secrets. |

The rest of this guide assumes the pull-based stack:

```bash
cp .env.production.example .env    # then edit it — every variable is documented there
docker compose -f docker-compose.prod.yml up -d
```

## 2. Generate secrets

Never reuse example values. Generate fresh ones:

```bash
openssl rand -hex 32      # BETTER_AUTH_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 24   # STORAGE_SECRET_ACCESS_KEY
```

## 3. Required `.env` for a domain

[`.env.production.example`](.env.production.example) is the authoritative,
fully commented template — the compose file fails fast if a required value is
missing. The shape, with `example.com` standing in for your domain:

```dotenv
# Image — pin a tag from https://github.com/lord007tn/nibleaf/releases
NIBLEAF_VERSION=v0.1.0

# The browser-facing dashboard origin. The app proxies /api to the server
# internally, so cookies stay first-party and this is the only web origin
# most deployments need.
APP_URL=https://docs.example.com

# Secrets — generated above.
BETTER_AUTH_SECRET=<openssl rand -hex 32>
POSTGRES_PASSWORD=<strong-password>
STORAGE_ACCESS_KEY_ID=<admin-user>
STORAGE_SECRET_ACCESS_KEY=<strong-password>

# Browser-reachable storage endpoints (presigned URLs + public assets).
# With bundled maxio, route this host to the maxio service at your proxy.
STORAGE_PUBLIC_ENDPOINT=https://storage.example.com
STORAGE_PUBLIC_URL=https://storage.example.com/nibleaf

# Published docs domains.
SITE_BASE_DOMAIN=docs.example.com                    # <project>.docs.example.com
CUSTOM_DOMAIN_CNAME_TARGET=cname.docs.example.com    # what customers CNAME to

# Email (see the Postmark section below). Verification emails are required
# by default (REQUIRE_EMAIL_VERIFICATION=true).
EMAIL_FROM=Nibleaf <no-reply@example.com>
POSTMARK_API_KEY=<server-token>          # or SMTP_URL=smtp://user:pass@host:587

# Worker ops dashboard credentials (see section 4).
WORKBENCH_USER=<admin-user>
WORKBENCH_PASS=<strong-password>
```

> **Legacy names:** older guides used `PUBLIC_APP_URL` / `PUBLIC_API_URL` /
> `PUBLIC_STORAGE_ENDPOINT` / `PUBLIC_STORAGE_URL` / `STORAGE_ACCESS_KEY` /
> `STORAGE_SECRET_KEY`. The source-build `docker-compose.yml` still honors them
> as aliases, but new deployments should use the canonical names above — they
> are what the apps themselves read.

### Using Cloudflare R2 / AWS S3 instead of maxio

Point the `STORAGE_*` variables at your bucket; the bundled `maxio` service is
then simply unused:

```dotenv
STORAGE_PROVIDER=r2                                  # or s3
STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_PUBLIC_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=<access-key-id>
STORAGE_SECRET_ACCESS_KEY=<secret-access-key>
STORAGE_BUCKET=<bucket>
STORAGE_FORCE_PATH_STYLE=true                        # R2/maxio/MinIO; false for AWS S3
STORAGE_PUBLIC_URL=https://cdn.example.com/<bucket>
```

`STORAGE_PUBLIC_ENDPOINT` must be reachable from the browser because presigned
upload/download URLs are returned to the dashboard. `STORAGE_PUBLIC_URL` is the
public asset/CDN base used when rendering uploaded files. Bucket creation and
CORS setup are best-effort on API boot, so external R2/S3 deployments start
without the bundled storage service.

## 4. Keep internal ports internal

`docker-compose.prod.yml` publishes **only** the `app` port, bound to
`127.0.0.1` by default (set `NIBLEAF_BIND=0.0.0.0` only when TLS terminates on
another machine). Postgres, Dragonfly, maxio, `server`, and `worker` stay on
the internal Docker network — leave them there.

Two things deserve special care:

- **Worker ops dashboard** — the worker serves a BullMQ dashboard at
  `:4312/jobs` that is **unauthenticated unless `WORKBENCH_USER` and
  `WORKBENCH_PASS` are both set**. The prod compose file never publishes the
  port, but set the credentials anyway; if you must reach `/jobs`, publish it
  to loopback only (commented example in the compose file) or tunnel over SSH.
- **Source-build stack** — `docker-compose.yml` publishes Postgres/Dragonfly/
  maxio/API/worker host ports for local convenience. If you insist on running
  it in production, remove those `ports:` entries (an override file needs the
  `!reset` YAML tag to *clear* a list — merging `ports: []` does not).

## 5. nginx reverse proxy (dashboard + wildcard docs)

Terminate TLS at nginx and proxy everything to the `app` service — it serves
the dashboard, `/api` (proxied internally to `server`), the published docs
sites, and resolves project subdomains + custom domains by `Host` header.

With the prod compose file, `app` listens on `127.0.0.1:4310` on the host:

```nginx
# Dashboard + API — docs.example.com (the APP_URL origin)
server {
    listen 443 ssl http2;
    server_name docs.example.com;

    ssl_certificate     /etc/letsencrypt/live/docs.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docs.example.com/privkey.pem;

    client_max_body_size 50m;   # allow asset uploads

    location / {
        proxy_pass http://127.0.0.1:4310;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade (live updates)
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# Bundled maxio storage — storage.example.com (STORAGE_PUBLIC_ENDPOINT).
# Requires publishing maxio to loopback in the compose file (commented example
# there), e.g. 127.0.0.1:9300:9000. Skip this vhost when using R2/S3.
server {
    listen 443 ssl http2;
    server_name storage.example.com;

    ssl_certificate     /etc/letsencrypt/live/storage.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/storage.example.com/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:9300;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name docs.example.com storage.example.com;
    return 301 https://$host$request_uri;
}
```

If nginx runs *inside* the Compose network instead, `proxy_pass` to
`http://app:4310` / `http://maxio:9000` directly.

### Wildcard project subdomains (`SITE_BASE_DOMAIN`)

Free project subdomains (`<project>.docs.example.com`) need three things:

1. **Wildcard DNS** — `*.docs.example.com  A/AAAA → your server` (or a CNAME
   to your ingress host).
2. **A wildcard vhost** that forwards the original `Host` header — Nibleaf
   resolves the project from it:

   ```nginx
   server {
       listen 443 ssl http2;
       server_name *.docs.example.com;

       ssl_certificate     /etc/letsencrypt/live/wildcard.docs.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/wildcard.docs.example.com/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:4310;
           proxy_set_header Host              $host;   # ← load-bearing
           proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

3. **A wildcard certificate**, which Let's Encrypt only issues via the
   **DNS-01** challenge (HTTP-01 cannot prove control of `*.`). With certbot
   and Cloudflare DNS, for example:

   ```bash
   certbot certonly \
     --dns-cloudflare \
     --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
     -d 'docs.example.com' -d '*.docs.example.com' \
     --cert-name wildcard.docs.example.com
   ```

   Equivalent DNS plugins exist for Route53, DigitalOcean, Hetzner, etc.
   (`acme.sh` covers even more providers). Caddy does the same with a DNS
   provider module — see the next section, which can replace this nginx setup
   entirely.

## 6. Custom-domain TLS automation (Caddy on-demand TLS)

Customers can point their own domains (`docs.customer.com`) at your instance
via `CUSTOM_DOMAIN_CNAME_TARGET`. Certificates for *arbitrary customer
domains* can't be pre-provisioned — you need on-demand issuance at first
handshake. [Caddy](https://caddyserver.com)'s `on_demand_tls` does exactly
this, using an **ask endpoint** to decide whether a hostname deserves a
certificate. Nibleaf exposes the domain-resolution lookup at:

```
GET /api/public/domains/resolve?host=<hostname>
→ 200 {"data":{"projectId":"…"}}      # known (verified) custom domain
→ 200 {"data":{"projectId":null}}     # unknown host
```

> **Caveat (as of v0.1.0):** Caddy's `ask` contract is status-code based —
> 200 allows, anything else denies — and Caddy calls it with `?domain=<host>`.
> The current endpoint expects `host=` and answers `200` even for unknown
> hosts, so it is **not yet directly usable** as the ask URL: pointing `ask`
> at it today denies all requests (missing `host` → 400), which is safe but
> inert. A Caddy-compatible ask response (`domain=` accepted, non-200 for
> unknown hosts) is planned; until it ships, keep this section as the target
> architecture.

Caddyfile — dashboard + wildcard subdomains + on-demand custom domains:

```caddyfile
{
    email admin@example.com
    on_demand_tls {
        # Only issue certs for hosts Nibleaf recognizes as verified domains.
        ask http://app:4310/api/public/domains/resolve
    }
}

# Dashboard + API (APP_URL)
docs.example.com {
    reverse_proxy app:4310
}

# Free project subdomains — wildcard cert via DNS-01 (requires a Caddy build
# with your DNS provider module, e.g. caddy-dns/cloudflare).
*.docs.example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy app:4310
}

# Bundled maxio storage (STORAGE_PUBLIC_ENDPOINT); drop if using R2/S3.
storage.example.com {
    reverse_proxy maxio:9000
}

# Customer custom domains — cert issued on first handshake, gated by `ask`.
https:// {
    tls {
        on_demand
    }
    reverse_proxy app:4310
}
```

Optional compose service (add to `docker-compose.prod.yml`, then remove the
`app` port mapping since Caddy joins the internal network):

```yaml
  caddy:
    image: caddy:2.10.0
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"   # HTTP/3
    environment:
      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN:-}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      app:
        condition: service_healthy

volumes:
  caddy-data:
  caddy-config:
```

(Use a custom Caddy image built with your DNS provider module for the
wildcard block, e.g. `FROM caddy:2.10.0-builder` + `xcaddy build
--with github.com/caddy-dns/cloudflare`.)

## 7. Email delivery (Postmark)

Sign-up verification (`REQUIRE_EMAIL_VERIFICATION=true`, the production
default), password resets, and team invites are sent by the worker.
[Postmark](https://postmarkapp.com) is the first-class provider — set
`POSTMARK_API_KEY` (a **Server API token**) and you're done; `SMTP_URL` is the
generic fallback for any other provider.

- **Verify your sender domain** in Postmark (Sender Signatures → domain) —
  this adds their DKIM record and return-path CNAME to your DNS. `EMAIL_FROM`
  must be an address on a verified domain or Postmark rejects the send. As a
  worked example: the domain `nibleaf.com` is verified for Nibleaf Cloud,
  which sends as `EMAIL_FROM=Nibleaf <no-reply@nibleaf.com>` — substitute your
  own domain for your instance.
- **SPF** — Postmark's SPF is covered by the return-path CNAME they give you;
  if you also send from other systems, make sure your domain's SPF record
  stays a single merged `v=spf1 …` TXT.
- **DKIM** — the TXT record from the Postmark domain-verification screen.
- **DMARC** — add at least a monitoring policy so mailbox providers trust the
  domain: `_dmarc.example.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com"`,
  tightening to `p=quarantine`/`p=reject` once the reports look clean.
- `POSTMARK_MESSAGE_STREAM` selects a non-default stream (leave empty for the
  default transactional stream).

Without `POSTMARK_API_KEY` or `SMTP_URL`, the worker only logs outgoing mail —
fine for a trial, but sign-up verification emails will never arrive; either
configure a provider or set `REQUIRE_EMAIL_VERIFICATION=false`.

## 8. Backups and restore

Aim for at least a **24-hour RPO** (one backup per day); tighten to hourly
database dumps if your team edits docs all day. Two supported paths — use
either, but **store copies off the host** (rclone/restic to object storage).

**a) Backup script + cron** — [`scripts/backup.sh`](scripts/backup.sh) does a
`pg_dump` (custom format) plus a tar of the maxio storage volume, with
retention pruning:

```bash
# nightly at 03:00, keep 14 days (see the script header for all options)
0 3 * * *  cd /opt/nibleaf && ./scripts/backup.sh >> /var/log/nibleaf-backup.log 2>&1
```

**b) Sidecar container** — `docker-compose.prod.yml` ships a commented-out
`pg-backup` service ([`prodrigestivill/postgres-backup-local`](https://github.com/prodrigestivill/docker-postgres-backup-local),
pinned) that writes rotated dumps to `./backups` on a schedule with
daily/weekly/monthly retention. Uncomment it and `up -d`. It covers the
database only — pair it with the script (or your S3 provider's versioning)
for uploaded assets.

**Test the restore.** A backup you have never restored is a hope, not a plan:

```bash
# 1. Restore the dump into a scratch database inside the postgres container
docker compose -f docker-compose.prod.yml exec -T postgres createdb -U nibleaf nibleaf_restore_test
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U nibleaf -d nibleaf_restore_test < backups/nibleaf-db-<STAMP>.dump

# 2. Sanity-check row counts, then drop the scratch DB
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U nibleaf -d nibleaf_restore_test -c 'SELECT count(*) FROM page;'
docker compose -f docker-compose.prod.yml exec -T postgres dropdb -U nibleaf nibleaf_restore_test
```

Full-disaster restore steps (database + storage volume) are documented in the
header of [`scripts/backup.sh`](scripts/backup.sh). Always take a fresh backup
**before** upgrading — see [UPGRADING.md](UPGRADING.md).

## 9. A note on the baked API URL

The published image bakes `VITE_API_URL=http://server:4311` at **build time**
(a Vite client build-time constant). This is correct for the Compose topology:
the browser never calls the server directly — the app's Nitro server proxies
`/api` to `server:4311` over the internal network. You do **not** need to
change it for the standard deployment.

If you split the apps onto different hosts (a non-Compose topology where the
browser must reach the API at a public URL), build your own image:

```bash
docker build --build-arg VITE_API_URL=https://api.example.com -t nibleaf .
```

## 10. Migrations and scaling

The `migrate` service applies Prisma migrations and exits; `server` and
`worker` wait for it to complete successfully — a plain `up -d` is always
migration-safe. To run it explicitly before scaling out:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d --scale worker=2
```

Seeding is **off by default in production** — the entrypoint only seeds when
`NIBLEAF_RUN_SEED=true` (or `NODE_ENV=development`). Leave it unset so no demo
account is created.

## 11. Rate limiting behind a proxy

The API keys its rate-limit buckets on the visitor's IP, read from
`X-Forwarded-For` using **rightmost-untrusted** parsing: proxies *append* to that
header, so the leftmost entries are whatever the client sent and are ignored.
Hops from private-network proxies (nginx, Traefik, the app's own `/api` proxy)
are skipped automatically.

- Behind private-network proxies only (the default topology): nothing to set.
- Behind a **public** edge that appends its own address (Cloudflare, a cloud load
  balancer): set `TRUSTED_PROXY_HOPS` to the number of such hops (usually `1`).
  Setting it higher than your real proxy depth lets clients forge their identity
  and evade rate limits.

Published docs pages are rendered server-side by the app, which calls the API
internally — without help, every visitor would share the app container's bucket.
Set `INTERNAL_API_SECRET` (`openssl rand -hex 32`) on **both** the app and server
services so the app can attribute SSR requests to the real visitor. When unset,
the hint is ignored (safe, but SSR traffic shares one bucket).

Tune `RATE_LIMIT_PUBLIC_PER_MIN` (default `300`) for the public site-serving API.

## 12. Security checklist

- [ ] `BETTER_AUTH_SECRET` generated with `openssl rand -hex 32` (not a default).
- [ ] Strong, unique `POSTGRES_PASSWORD` and `STORAGE_SECRET_ACCESS_KEY` (or R2/S3 keys).
- [ ] `NODE_ENV=production` set (enables the entrypoint secret preflight).
- [ ] Postgres / Dragonfly / maxio / server / worker ports **not** published publicly.
- [ ] `WORKBENCH_USER` / `WORKBENCH_PASS` set (the worker's `/jobs` dashboard is unauthenticated without them).
- [ ] TLS terminated at the reverse proxy; HTTP redirects to HTTPS.
- [ ] `TRUSTED_ORIGINS` / `CORS_ALLOWED_ORIGINS` not overridden beyond your real origins.
- [ ] `STORAGE_CORS_ALLOWED_ORIGINS` restricted to the dashboard origin.
- [ ] `REQUIRE_EMAIL_VERIFICATION=true` (default) with working email delivery — or a deliberate decision to disable it.
- [ ] `NIBLEAF_RUN_SEED` left unset (no demo account in production).
- [ ] Backups scheduled (section 8) **and restore tested**.
- [ ] `NIBLEAF_VERSION` pinned; upgrades follow [UPGRADING.md](UPGRADING.md).
- [ ] `TRUSTED_PROXY_HOPS` matches your real public-proxy depth (section 11) — never higher.
- [ ] `INTERNAL_API_SECRET` set on both app and server (accurate per-visitor rate limiting).

## Appendix: Coolify

Use `docker-compose.coolify.yml` when deploying to Coolify. It pulls
`ghcr.io/lord007tn/nibleaf:latest` by default (pin with `NIBLEAF_IMAGE=…:v0.1.0`)
and exposes:

- `app:4310` — dashboard, editor, published docs, project subdomains, custom domains.
- `admin:4315` — internal platform admin panel.
- `maxio:9000` — bundled storage, only if you don't use external R2/S3.

In Coolify, assign the dashboard host, wildcard docs host, and custom-domain
CNAME target to the `app` service; the storage host to `maxio`. For example:

- `docs.example.com → app:4310`
- `*.docs.example.com → app:4310`
- `cname.docs.example.com → app:4310`
- `storage.example.com → maxio:9000`

The compose file reads Coolify-generated values (`SERVICE_USER_POSTGRES`,
`SERVICE_PASSWORD_64_POSTGRES`, `SERVICE_USER_STORAGE`,
`SERVICE_PASSWORD_64_STORAGE`, `SERVICE_HEX_64_NIBLEAF`). Set
`SITE_BASE_DOMAIN`, `CUSTOM_DOMAIN_CNAME_TARGET`, `POSTMARK_API_KEY`, and
`WORKBENCH_USER`/`WORKBENCH_PASS` manually in the Coolify environment screen.
