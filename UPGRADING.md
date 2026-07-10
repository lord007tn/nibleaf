# Upgrading Nibleaf

This guide covers upgrading a self-hosted Nibleaf running from the pull-based
[`docker-compose.prod.yml`](docker-compose.prod.yml) stack. Every release is
published to [GitHub Releases](https://github.com/lord007tn/nibleaf/releases)
with a changelog and a matching image tag on
`ghcr.io/lord007tn/nibleaf` (e.g. `v0.1.0`).

## Versioning and breaking-change policy

Nibleaf is pre-1.0, so treat versions as semver-ish:

- **Patch** (`v0.1.0 → v0.1.1`) — fixes only; always safe to apply.
- **Minor** (`v0.1.x → v0.2.0`) — new features and possibly new env variables
  or migrations. Anything you must do by hand is called out in the release
  notes under **Breaking changes / Upgrade notes**.
- We will not silently change the meaning of an existing env variable, drop a
  compose service, or require a manual migration step without flagging it in
  the release notes for that version.

Database migrations are forward-only and run automatically: the `migrate`
service applies pending Prisma migrations before `server`/`worker`/`app` start.

## Standard upgrade (pinned tag)

1. **Snapshot first.** Migrations are not reversible — a backup is your
   rollback path:

   ```bash
   ./scripts/backup.sh          # pg_dump + storage volume archive
   ```

2. **Bump the tag** in your `.env`:

   ```dotenv
   NIBLEAF_VERSION=v0.2.0       # pick the tag from GitHub Releases
   ```

3. **Read the release notes** for every version between yours and the target —
   new required env variables go in the same `.env`.

4. **Pull and roll:**

   ```bash
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```

   `migrate` runs the new migrations and exits; the long-running services
   restart on the new image. Published docs sites keep serving during the roll
   (they are read from immutable deployment snapshots).

5. **Verify:** `docker compose -f docker-compose.prod.yml ps` shows everything
   `healthy`, and the dashboard loads. Check `docker compose logs migrate` if
   `server` refuses to start.

## Rollback

Rolling back the **image** is easy; rolling back the **database** is a restore.

- If the new version misbehaves but ran no new migrations (check
  `docker compose logs migrate` — "applying database migrations" lists what
  ran): set `NIBLEAF_VERSION` back, `pull`, `up -d`. Done.
- If new migrations ran, the old image may not understand the new schema.
  Restore the pre-upgrade dump, then pin the old tag:

  ```bash
  docker compose -f docker-compose.prod.yml stop server worker app
  docker compose -f docker-compose.prod.yml exec -T postgres \
    pg_restore -U nibleaf -d nibleaf --clean --if-exists \
    < backups/nibleaf-db-<STAMP>.dump
  # set NIBLEAF_VERSION back in .env, then:
  docker compose -f docker-compose.prod.yml up -d
  ```

This is why step 1 above is not optional.

## ⚠ Postgres major versions (the 17 → 18 landmine)

The stack pins `postgres:17-alpine` **on purpose**. Postgres major upgrades
change the on-disk data directory format — pointing a `postgres:18` container
at a data volume written by 17 does **not** work (postgres 18 also changed the
default data-directory layout, which breaks the existing volume mount — this
repo hit exactly that and re-pinned to 17).

Do **not** bump the postgres image tag as part of a Nibleaf upgrade. When a
Nibleaf release does move the postgres major, the release notes will include a
dump-and-restore procedure (`pg_dumpall` from the old container → restore into
a fresh volume on the new one). Until then, stay on 17.

## Coolify deployments

The Coolify stack (`docker-compose.coolify.yml`) follows
`ghcr.io/lord007tn/nibleaf:latest` by default and redeploys via webhook after
CI passes on `main`. To hold Coolify to a fixed version instead, set
`NIBLEAF_IMAGE=ghcr.io/lord007tn/nibleaf:v0.2.0` in the Coolify environment
screen and redeploy.
