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

## Build, upload, inspect, gate, deploy

Follow these steps strictly in order. Nothing changes live traffic until step 4.

### 1. Build and upload

```sh
pnpm --filter @nibleaf/custom-domain-edge test
pnpm --filter @nibleaf/custom-domain-edge typecheck
pnpm --filter @nibleaf/custom-domain-edge build
pnpm --filter @nibleaf/custom-domain-edge run upload --dry-run
pnpm --filter @nibleaf/custom-domain-edge run upload --message "Reviewed proxy release"
```

The Vite build writes ignored `.cloudflare/output/v0/`. Uploading creates a
version without changing live traffic.

### 2. Inspect the uploaded version

```sh
pnpm --filter @nibleaf/custom-domain-edge exec cf workers versions get <uploaded-version> --worker-id nibleaf-custom-domain-edge --include modules
```

Compare the uploaded modules with the reviewed build, and inspect all bindings
before activating that exact version. The configuration preserves externally
managed plain-text/JSON variables; explicit declarations override their values.
The existing secret is retained. Verify preservation from the uploaded version,
not a successful upload alone.

### 3. Edge cache gate (stop the release if it fails)

`EDGE_CACHE_MODE` turns on the Worker's shared cache. The code defaults to `off`,
and this repository never declares the variable. An upload therefore keeps
whatever value is already bound outside the repository, and a stale `on` or
`stale-only` binding would switch caching on the moment the version is deployed.
Caching may only be enabled through its own approved runbook, never as a side
effect of a release.

Read the bindings of **both** the active and the uploaded version:

```sh
pnpm --filter @nibleaf/custom-domain-edge exec cf workers deployments list --worker nibleaf-custom-domain-edge
pnpm --filter @nibleaf/custom-domain-edge exec cf workers versions get <active-version> --worker-id nibleaf-custom-domain-edge
pnpm --filter @nibleaf/custom-domain-edge exec cf workers versions get <uploaded-version> --worker-id nibleaf-custom-domain-edge
```

For each version, find `EDGE_CACHE_MODE` in the bindings:

- **Absent, or the literal `off`:** continue to step 4.
- **Any other value (`on`, `stale-only`, or anything unrecognised), in either version:** **stop. Do not deploy.** Record which version carries it, and have the owner remove the variable (or set it to `off`) through the approved edge-cache runbook. Then re-upload and repeat steps 2–3.

### 4. Deploy (only after step 3 passes)

```sh
pnpm --filter @nibleaf/custom-domain-edge run deploy --versions '[{"version_id":"<uploaded-version>","percentage":100}]'
```

The deployment command changes version traffic only. Avoid `cf deploy` and
`cf workers triggers deploy` for this externally routed Worker.

### 5. Verify

Verify the active version, hashes, settings, bindings, and complete routes.
Validate a known internal custom hostname when one exists; an origin health
check does not establish customer-host routing or tenant isolation.

Then confirm from outside that edge caching stayed off. The check fails closed:
it only reports `OK` when every condition below holds, and any other outcome is
`FAIL`, never a pass.

1. **The request goes through the Worker.** The custom host's route must point
   at the Worker. A missing response header alone can't prove this, and Worker
   logs are sampled.
2. **The request completes.** curl must exit 0 and the response must be HTTP 200.
3. **The asset would be cacheable.** It must meet the Worker's own storage rules:
   - a content-hashed path;
   - `x-nibleaf-static-build: 1`;
   - `immutable` in `Cache-Control`, with no `private`, `no-store` or `no-cache`;
   - a JavaScript content type;
   - no `Set-Cookie`;
   - `Vary` limited to `Accept-Encoding`.
4. **Only then** does a missing `x-nibleaf-edge` header mean caching is off.

```sh
set -euo pipefail
host="${HOST:?set HOST to a verified customer hostname}"
: "${CF_API_TOKEN:?}" "${ZONE_ID:?}"   # read-only Workers Routes access

# 1. Route: <host>/* must map to the edge Worker.
script=$(curl -fsS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  | jq -r --arg p "$host/*" '[.result[] | select(.pattern == $p)] | if length == 1 then (.[0].script // "NONE") else "MISSING" end')
[ "$script" = "nibleaf-custom-domain-edge" ] || { echo "FAIL: $host/* routes to $script, not the edge Worker"; exit 1; }

# 2. A real hashed asset from the live page, fetched with GET.
page=$(curl -fsS "https://$host/") || { echo "FAIL: could not fetch https://$host/"; exit 1; }
asset=$(printf '%s' "$page" | grep -oE '/assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.js' | head -n 1 || true)
[ -n "$asset" ] || { echo "FAIL: no hashed asset found on https://$host/"; exit 1; }
if ! headers=$(curl -sS -o /dev/null -D - -w '%{http_code}' "https://$host$asset"); then
  echo "FAIL: transfer of $asset did not complete"; exit 1
fi
status=$(printf '%s' "$headers" | tail -n 1)
[ "$status" = "200" ] || { echo "FAIL: $asset returned HTTP $status"; exit 1; }
header() { printf '%s' "$headers" | tr -d '\r' | grep -i "^$1:" | head -n 1 | cut -d: -f2- | sed 's/^ *//' || true; }

# 3. Cache-eligible by the Worker's own rules.
[ "$(header x-nibleaf-static-build)" = "1" ] || { echo "FAIL: $asset lacks x-nibleaf-static-build: 1"; exit 1; }
cc=$(header cache-control | tr 'A-Z' 'a-z')
printf '%s' "$cc" | grep -qw immutable || { echo "FAIL: $asset is not immutable ($cc)"; exit 1; }
if printf '%s' "$cc" | grep -qwE 'private|no-store|no-cache'; then echo "FAIL: $asset Cache-Control forbids caching ($cc)"; exit 1; fi
header content-type | grep -qi 'javascript' || { echo "FAIL: $asset content-type is $(header content-type)"; exit 1; }
[ -z "$(header set-cookie)" ] || { echo "FAIL: $asset sets a cookie"; exit 1; }
vary=$(header vary | tr 'A-Z' 'a-z' | tr -d ' ' | tr ',' '\n' | grep -v '^accept-encoding$' | grep -v '^$' || true)
[ -z "$vary" ] || { echo "FAIL: $asset varies on $vary"; exit 1; }

# 4. Caching must be off.
edge=$(header x-nibleaf-edge)
[ -z "$edge" ] || { echo "FAIL: edge cache is ON for $asset (x-nibleaf-edge: $edge)"; exit 1; }
echo "OK: $host/* routes to the edge Worker; cache-eligible $asset served 200 with no edge cache header"
```

The app must already serve the `x-nibleaf-static-build` marker (#433). Until an
app release with it is live, step 3 fails by design rather than passing vacuously.

`FAIL: edge cache is ON` (`x-nibleaf-edge: hit` or `miss`) means caching is on:
roll back to the previous version (see Rollback). Any other `FAIL` means the
check itself didn't prove anything. Fix the cause (host, route, asset or
token) and rerun.

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
