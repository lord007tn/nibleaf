# Production deployment

This guide covers running Nibleaf in production with Docker Compose behind a TLS
reverse proxy. For local development see the [README](README.md).

> The container entrypoint **refuses to start** (`exit 1`) when `NODE_ENV=production`
> and `BETTER_AUTH_SECRET` is empty or left at a known demo default. Generate a real
> secret before your first deploy.

## 1. Generate secrets

Never reuse the demo defaults from `docker-compose.yml`. Generate fresh values:

```bash
# Auth secret — must be a strong, random 32+ byte value
openssl rand -hex 32

# Postgres + object-storage credentials
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 24   # STORAGE_SECRET_KEY (or your R2/S3 secret)
```

## 2. Required `.env` for a domain

Create a `.env` next to `docker-compose.yml`. Replace `your-domain.com` with your
real hostnames. Behind the reverse proxy the dashboard (`app`) is the primary
origin the browser talks to; it proxies `/api` to the server, so cookies stay
first-party.

```dotenv
NODE_ENV=production

# Secrets — generated above. The stack will not start with the demo defaults.
BETTER_AUTH_SECRET=<openssl rand -hex 32>
POSTGRES_PASSWORD=<strong-password>
STORAGE_ACCESS_KEY=<admin-user>
STORAGE_SECRET_KEY=<strong-password>

# Auth + CORS. BETTER_AUTH_URL is the dashboard origin (the browser-facing app).
BETTER_AUTH_URL=https://app.your-domain.com
TRUSTED_ORIGINS=https://app.your-domain.com,https://your-domain.com
CORS_ALLOWED_ORIGINS=https://app.your-domain.com,https://your-domain.com

# Public origins used to build cross-app links and the storage CORS policy.
PUBLIC_APP_URL=https://app.your-domain.com
PUBLIC_API_URL=https://app.your-domain.com        # API is reached via the app proxy
PUBLIC_WWW_URL=https://your-domain.com
PUBLIC_STORAGE_ENDPOINT=https://storage.your-domain.com
PUBLIC_STORAGE_URL=https://cdn.your-domain.com/nibleaf

# Published docs domains. Create *.docs.your-domain.com at your proxy/Coolify
# ingress so project slugs resolve as <slug>.docs.your-domain.com.
SITE_BASE_DOMAIN=docs.your-domain.com
CUSTOM_DOMAIN_CNAME_TARGET=cname.docs.your-domain.com

# Object storage. Keep the maxio defaults, or switch to R2/S3 below.
STORAGE_PROVIDER=maxio
STORAGE_PUBLIC_URL=https://cdn.your-domain.com/nibleaf
```

Custom domains and free project subdomains are resolved by Nibleaf after traffic
reaches the `app` service. TLS certificates, wildcard DNS, and the public ingress
for `*.docs.your-domain.com` remain reverse-proxy or Coolify responsibilities.

### Using Cloudflare R2 / AWS S3 instead of maxio

Drop the bundled `maxio` service (or ignore it) and point `STORAGE_*` at your bucket:

```dotenv
STORAGE_PROVIDER=r2                                  # or s3
STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
PUBLIC_STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=<access-key-id>
STORAGE_SECRET_KEY=<secret-access-key>
STORAGE_BUCKET=<bucket>
STORAGE_FORCE_PATH_STYLE=true                        # R2/maxio; false for AWS S3
PUBLIC_STORAGE_URL=https://cdn.your-domain.com/<bucket>
```

`PUBLIC_STORAGE_ENDPOINT` becomes the container's `STORAGE_PUBLIC_ENDPOINT` and
must be reachable from the browser because presigned upload/download URLs are
returned to the dashboard. `PUBLIC_STORAGE_URL` is the public asset/CDN base
used when rendering uploaded files.

The app containers do not wait on local `maxio` during startup. Bucket creation
and CORS setup are best-effort on API boot, so external R2/S3 deployments can
start without a bundled storage service.

## 3. Do not expose datastore ports

The default `docker-compose.yml` publishes Postgres, Dragonfly, and maxio host ports
for local convenience. **In production these must not be reachable from the public
internet.** Add a `docker-compose.prod.yml` override that drops the host port
mappings (and keeps them on the internal Docker network):

```yaml
# docker-compose.prod.yml — internal-only datastores
services:
  postgres:
    ports: []
  dragonfly:
    ports: []
  maxio:
    ports: []
```

Bring the stack up with both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Only the reverse proxy should bind public ports (443/80). The `app` and `www`
services are reached through it; the `server` and `worker` ports stay internal.

### Coolify without marketing

Use `docker-compose.coolify.yml` when deploying the self-hostable docs platform
to Coolify. It omits the `www` marketing service, builds the Nibleaf image with
Coolify's generated public URLs, defaults app containers to
`ghcr.io/lord007tn/nibleaf:latest`, and exposes:

- `app:4310` for dashboard, editor, published docs, project subdomains, and
  custom domains.
- `server:4311` for the API, usually internal because `app` proxies `/api`.
- `worker:4312` internally for background jobs.
- `maxio:9000` only if you use bundled storage as a public media origin.

In Coolify, assign the dashboard host, wildcard docs host, and custom-domain
CNAME target to the `app` service. Assign the storage host to `maxio` unless
you use external R2/S3 storage. For example:

- `app.your-domain.com -> app:4310`
- `*.docs.your-domain.com -> app:4310`
- `cname.docs.your-domain.com -> app:4310`
- `storage.your-domain.com -> maxio:9000`

The compose file reads Coolify-generated values such as `SERVICE_URL_APP`,
`SERVICE_URL_MAXIO`, `SERVICE_USER_POSTGRES`, `SERVICE_PASSWORD_64_POSTGRES`,
`SERVICE_USER_STORAGE`, `SERVICE_PASSWORD_64_STORAGE`, and
`SERVICE_HEX_64_NIBLEAF`. Set `SITE_BASE_DOMAIN` and
`CUSTOM_DOMAIN_CNAME_TARGET` manually in the Coolify environment screen.

## 4. nginx reverse proxy (TLS termination)

Terminate TLS at nginx and proxy to the `app` (dashboard, the main origin) and
`www` (marketing) services. The `app` already proxies `/api` internally, so nginx
only needs to forward to it.

```nginx
# Marketing site — your-domain.com
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://www:4313;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Dashboard + API + live docs — app.your-domain.com (the primary origin)
server {
    listen 443 ssl http2;
    server_name app.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/app.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.your-domain.com/privkey.pem;

    client_max_body_size 50m;   # allow asset uploads

    location / {
        proxy_pass http://app:4310;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade (HMR / live updates)
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.com app.your-domain.com;
    return 301 https://$host$request_uri;
}
```

If nginx runs outside the Compose network, publish the `app`/`www` host ports
locally (e.g. bind to `127.0.0.1`) and `proxy_pass` to those instead of the
service names.

## 5. A note on the baked API URL

The `app` image bakes `VITE_API_URL=http://server:4311` at **build time** (it is a
Vite client build-time constant). This is correct for the Compose topology, where
the browser never calls the server directly — the app's Nitro server proxies
`/api` to `server:4311` over the internal network. You do **not** need to change it
for the standard Compose deployment.

If you split the apps onto different hosts (a non-Compose topology where the
browser must reach the API at a public URL), rebuild the `app` image with a
different value, e.g.:

```bash
docker build --build-arg VITE_API_URL=https://api.your-domain.com -t nibleaf .
```

## 6. Run migrations before scaling

The `migrate` service applies Prisma migrations and exits; `server` and `worker`
wait for it to complete successfully. Run it **once** before scaling out:

```bash
# apply migrations (and only seed if NIBLEAF_RUN_SEED=true)
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm migrate

# then bring up / scale the long-running services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Seeding is **off by default in production** — the entrypoint only seeds when
`NIBLEAF_RUN_SEED=true` (or `NODE_ENV=development`). Leave it unset in production so
no demo account is created.

## 7. Security checklist

- [ ] `BETTER_AUTH_SECRET` generated with `openssl rand -hex 32` (not a default).
- [ ] Strong, unique `POSTGRES_PASSWORD` and `STORAGE_SECRET_KEY` (or R2/S3 keys).
- [ ] `NODE_ENV=production` set (enables the entrypoint secret preflight).
- [ ] Postgres / Dragonfly / maxio host ports **not** published publicly (prod override).
- [ ] TLS terminated at the reverse proxy; HTTP redirects to HTTPS.
- [ ] `TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` list only your real origins.
- [ ] `STORAGE_CORS_ALLOWED_ORIGINS` restricted to the dashboard origin.
- [ ] `NIBLEAF_RUN_SEED` left unset (no demo account in production).
- [ ] Database and object storage backed up on a schedule.
- [ ] Container images rebuilt and redeployed for security updates.


