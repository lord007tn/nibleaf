# Operating Nibleaf Cloud

This runbook is for the managed multi-tenant service at `nibleaf.com`. It is
separate from the self-hosting guide in [DEPLOYMENT.md](DEPLOYMENT.md).

## Production topology

[`docker-compose.coolify.yml`](docker-compose.coolify.yml) runs one image in
separate roles:

- `app` — marketing site, dashboard, editor, published sites, and the `/api`
  same-origin proxy.
- `server` — private API and auth service.
- `worker` — publishing, search, analytics, and email jobs.
- `migrate` — one-shot Prisma migration gate before application startup.
- `postgres` — source of truth.
- `dragonfly` — Redis-compatible BullMQ backend.
- `maxio` — S3-compatible object storage. Cloudflare R2 can replace it later.
- `admin` — private platform-operator console.

Only `app`, `admin`, and `maxio` receive public hostnames. Postgres, Dragonfly,
the API, and worker must remain on the private Docker network.

## Required Coolify domains

The port suffixes are required because every role uses the same image and that
image exposes several ports:

| Service | Coolify domain |
| --- | --- |
| `app` | `https://nibleaf.com:4310,https://www.nibleaf.com:4310` |
| `admin` | `https://admin.nibleaf.com:4315` |
| `maxio` | `https://storage.nibleaf.com:9000` |

Without the explicit `:4315`, Coolify can proxy the admin hostname to port 4310
and return 502 even though the admin container reports healthy.

## Required production configuration

Coolify generates the Postgres, storage, and auth secrets referenced by the
compose file. Configure these operator-owned values as secrets:

- `POSTMARK_API_KEY` and `POSTMARK_MESSAGE_STREAM` for verification, password
  reset, and invitation email.
- `INTERNAL_API_SECRET` for trusted visitor-IP forwarding between app and API.
- `WORKBENCH_USER` and `WORKBENCH_PASS` for the private BullMQ dashboard.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` only when Google sign-in is
  enabled. The callback is `https://nibleaf.com/api/auth/callback/google`.
- `OPENAI_API_KEY` only when AI writing assistance is enabled.

Keep `REQUIRE_EMAIL_VERIFICATION=true` on the public cloud. Set
`TRUSTED_PROXY_HOPS` only after confirming the real Cloudflare/Traefik forwarded
header chain; too large a value lets clients spoof rate-limit identities.

## Deployment pipeline

1. CI typechecks, lints, and tests every change to `main`.
2. A successful CI push builds the exact validated commit for amd64 and arm64.
3. The image is published to `ghcr.io/lord007tn/nibleaf:latest`.
4. GitHub calls the Coolify deploy webhook.
5. Coolify runs migrations, waits for API health, then starts the worker and app.

The GitHub repository needs these Actions secrets:

- `COOLIFY_NIBLEAF_DEPLOY_WEBHOOK`
- `COOLIFY_NIBLEAF_API_TOKEN`

Do not deploy from an unprotected branch. Tagged releases should use semantic
versions (`vMAJOR.MINOR.PATCH`) and production rollbacks should pin
`NIBLEAF_IMAGE` to a known-good tag or digest.

## Backups

Configure a Coolify scheduled Postgres backup before accepting production data:

- schedule: daily at minimum (hourly is preferable during beta);
- retention: 7 daily, 4 weekly, and 6 monthly copies;
- destination: an S3 bucket on a different provider/account from the server;
- encryption: enabled with the key stored outside the Coolify host.

Run a restore drill into a scratch database after enabling the schedule and at
least quarterly afterward. Object storage needs a separate replication or sync
policy; a database dump does not contain uploaded assets.

## Launch verification

After every infrastructure change:

1. `GET https://nibleaf.com/` returns 200 and the baseline security headers.
2. `GET https://nibleaf.com/api/app/health` returns `{"ok":true}`.
3. `GET https://storage.nibleaf.com/healthz` returns 200.
4. `GET https://admin.nibleaf.com/sign-in` returns 200 and `Cache-Control: no-store`.
5. Create a test account and confirm the Postmark verification message arrives.
6. Create, edit, publish, search, and export a disposable site.
7. Verify its wildcard subdomain, custom-domain flow, sitemap, `robots.txt`, and
   `llms.txt`.
8. Confirm the worker has no failed/stalled jobs and the latest scheduled backup
   is restorable.

## Public-release gate

The product describes itself as open source, so both the GitHub repository and
the GHCR package must be publicly readable before announcing self-hosting. Before
changing repository visibility:

1. Run the full-history Secret scanning workflow and rotate any finding.
2. Confirm `.env` has never been committed.
3. Make the repository public.
4. Make the `nibleaf` GHCR package public and link it to the repository.
5. Verify an unauthenticated machine can clone the repository and pull
   `ghcr.io/lord007tn/nibleaf:latest`.
6. Enable branch protection/rulesets for `main`, requiring CI, Docker, CodeQL,
   OSV, and secret scanning.

