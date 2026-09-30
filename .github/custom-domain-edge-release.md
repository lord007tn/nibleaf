# Custom-domain edge releases

Use the pinned `cf` CLI through the `@nibleaf/custom-domain-edge` package scripts.
Node.js 22.18 or later is required. The serving Worker name, compatibility date,
origin, and proxy source are unchanged by this CLI migration.

## Capture the baseline

Use an existing authorized profile. Verify `cf auth whoami`, resolve the zone's
owning account, and set `CLOUDFLARE_ACCOUNT_ID` in the release environment. Never
commit credentials or provider snapshots.

```sh
pnpm --filter @nibleaf/custom-domain-edge exec cf zones list --name nibleaf.com
pnpm --filter @nibleaf/custom-domain-edge exec cf workers deployments list --worker nibleaf-custom-domain-edge
pnpm --filter @nibleaf/custom-domain-edge exec cf workers get nibleaf-custom-domain-edge
pnpm --filter @nibleaf/custom-domain-edge exec cf workers versions get <active-version> --worker-id nibleaf-custom-domain-edge --include modules
```

Retain the complete active modules, hashes, bindings, secret names, runtime
settings, and full route table privately. Routes are managed outside this
repository; preserve every no-Worker exception as well as the serving route.

## Build, upload, inspect, deploy

```sh
pnpm --filter @nibleaf/custom-domain-edge test
pnpm --filter @nibleaf/custom-domain-edge typecheck
pnpm --filter @nibleaf/custom-domain-edge build
pnpm --filter @nibleaf/custom-domain-edge run upload --dry-run
pnpm --filter @nibleaf/custom-domain-edge run upload --message "Reviewed proxy release"
pnpm --filter @nibleaf/custom-domain-edge exec cf workers versions get <uploaded-version> --worker-id nibleaf-custom-domain-edge --include modules
pnpm --filter @nibleaf/custom-domain-edge run deploy --versions '[{"version_id":"<uploaded-version>","percentage":100}]'
```

The Vite build writes ignored `.cloudflare/output/v0/`. Uploading creates a
version without changing live traffic. Compare the uploaded modules with the
reviewed build and inspect all bindings before activating that exact version.
The configuration preserves externally managed plain-text/JSON variables;
explicit declarations override their values. The existing secret is retained.
Verify preservation from the uploaded version, not a successful upload alone.

The deployment command changes version traffic only. Avoid `cf deploy` and
`cf workers triggers deploy` for this externally routed Worker. After deployment,
verify the active version, hashes, settings, bindings, and complete routes.
Validate a known internal custom hostname when one exists; an origin health
check does not establish customer-host routing or tenant isolation.

## Rollback

```sh
pnpm --filter @nibleaf/custom-domain-edge run deploy --versions '[{"version_id":"<previous-version>","percentage":100}]' --dry-run
pnpm --filter @nibleaf/custom-domain-edge run deploy --versions '[{"version_id":"<previous-version>","percentage":100}]'
```

Check the previous version's bindings and secret compatibility first. Verify
the resulting active version and route table. Keep the baseline and receipt;
never delete the Worker, rotate secrets, or recreate routes to roll back code.

See [Cloudflare configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)
and [version management](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/).
