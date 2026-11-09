# Maxio upload regression

Owned disposable stack: `docker compose -p nibleaf-upload -f tests/integration/maxio-upload/compose.yml up -d`.
No shared containers are used. PostgreSQL is on 5582 (5442 + 140), Redis on 6519 (6379 + 140), maxio on 9440 (9300 + 140), Traefik on 220 (80 + 140). Host application ports follow the requested 4530/4531 allocation; no worker is needed for upload confirmation.

From the repository root, with dependencies installed and workspace packages built:

1. Migrate: `node --env-file=tests/integration/maxio-upload/fixture.env node_modules/prisma/build/index.js migrate deploy --config packages/database/prisma.config.ts`.
2. In apps/server: `node --env-file=../../tests/integration/maxio-upload/fixture.env --import tsx src/index.ts`.
3. In apps/app: `node --env-file=../../tests/integration/maxio-upload/fixture.env ../../node_modules/vite/bin/vite.js --port 4530 --host 127.0.0.1`.
4. `pnpm test:upload:integration` reproduces the Traefik 403, then asserts API PUT 204, token reuse 400, confirm 201, stored bytes and a full 50 MiB upload. It provisions a fictional account and saves an ignored local session fixture.
5. `pnpm test:upload:browser` uses a private headless Chromium 1248 process and the editor Image file picker, then checks confirmation and image decoding. Requires the existing Windows Playwright Chromium installation. Captures screenshot and video under `.github/assets/maxio-upload-proxy`.
6. Stop only the processes started above and `docker compose -p nibleaf-upload -f tests/integration/maxio-upload/compose.yml down`.

The integration environment contains only disposable local credentials. Never point this fixture at a shared or production database.

## Body handling

Hono's upload route admits 50 MiB after the editor guard; the internal storage stream counts bytes against the exact reservation and the cap. Both Node adapters used here have no configured global body ceiling. Installed H3's proxyRequest forwards `event.req.body`, Content-Length and cookies without buffering. The 50 MiB integration PUT traverses Vite/Nitro's same-origin API proxy and the Hono Node adapter; no global limits are raised. Production Nitro uses the same H3 proxy rule. A deployment's external reverse-proxy body ceiling remains operator configuration.
