# Runbook: route `*.nibleaf.com` docs sites through the edge Worker

**Status:** proposed, needs owner approval before any step runs. It changes Cloudflare routing for the `nibleaf.com` zone.
**Why:**
- Customer custom domains already pass through the `nibleaf-custom-domain-edge` Worker. Since #433, that Worker shows a branded EN/AR maintenance page while the origin is down, in place of Traefik's raw `no available server` 503.
- Free subdomain sites (`<slug>.nibleaf.com`, for example `joodpms.nibleaf.com`) go straight to the origin today, so they still show the raw page during every deploy (READER-01 / PUBLIC-01).
- This runbook puts them behind the same Worker, with explicit **no-Worker exceptions** for every hostname that is not a docs site.

**Companion runbook:** [`runbook-rolling-deploys.md`](runbook-rolling-deploys.md). It removes the outage itself; this one makes the remaining edge cases graceful.

## 1. What changes

| Route pattern (zone `nibleaf.com`) | Worker | Purpose |
| --- | --- | --- |
| `*.nibleaf.com/*` | `nibleaf-custom-domain-edge` | every subdomain docs site |
| `www.nibleaf.com/*` | **None** | marketing redirect, served by the app |
| `admin.nibleaf.com/*` | **None** | internal admin |
| `api.nibleaf.com/*` | **None** | API host, if present |
| `storage.nibleaf.com/*` | **None** | maxio public storage |
| `cname.nibleaf.com/*` | **None** | DNS-only SaaS ingress target. Kept as an explicit exception in case it is ever proxied. |
| *every other non-docs hostname found in step 2.2* | **None** | for example status, mail or other product hosts |

- The apex `nibleaf.com/*` is not matched by `*.nibleaf.com/*` and keeps no Worker.
- [Cloudflare picks the most specific matching route](https://developers.cloudflare.com/workers/configuration/routing/routes/#matching-behavior), so each exact-host "None" route wins over the wildcard.
- The per-customer routes (`<custom-host>/*`) that the server creates through Cloudflare for SaaS are not touched.

**Why the Worker needs no code change.**
- The Worker forwards to `APP_ORIGIN` (`https://nibleaf.com`) and stamps `x-nibleaf-custom-host: <slug>.nibleaf.com` together with the edge secret.
- The app accepts that host because of the secret (`apps/app/src/server.ts`, `effectiveRequestHost`).
- `resolveDomainHost` maps `<slug>.<SITE_BASE_DOMAIN>` to the project, exactly as it does today for direct requests.
- Canonical URLs come from `x-forwarded-host`/`-proto`, which the Worker stamps from the reader's own request.

## 2. Steps (Cloudflare dashboard or API; the owner or the master runs them)

Setup:
- Use an API token with **Zone → Workers Routes → Edit** and **Zone → DNS → Read** on `nibleaf.com` only.
- Export `CF_API_TOKEN` and `ZONE_ID` (the `nibleaf.com` zone id) in your shell. Never commit them.

### 2.1 Baseline
1. Save the current route table:
   ```sh
   curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
     "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" | tee routes-before.json | jq -r '.result[] | "\(.id) \(.pattern) \(.script // "NONE")"'
   ```
2. **If `*.nibleaf.com/*` already maps to `nibleaf-custom-domain-edge`, stop here: there is nothing to do.** Verify with §3 instead.
3. Confirm the Worker's active version is the #433 build, which includes the maintenance page:
   ```sh
   pnpm --filter @nibleaf/custom-domain-edge exec cf workers deployments list --worker nibleaf-custom-domain-edge
   ```

### 2.2 Find every non-docs hostname
```sh
curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=500" \
  | jq -r '.result[] | select(.name|endswith(".nibleaf.com")) | "\(.name) \(.type) proxied=\(.proxied)"' | sort -u
```
- Every **proxied** hostname that is not a docs-site subdomain needs a "None" route in 2.3.
- The wildcard `*.nibleaf.com` record itself is the one that should reach the Worker.
- DNS-only records (proxied=false) never run Workers, but listing them does no harm.
- **Question to settle before 2.3:** is `docs.nibleaf.com` a published Nibleaf site (keep it on the Worker) or something else (add an exception)?

### 2.3 Add the exceptions, read them back, and only then add the wildcard
Run this as one script. It **fails closed**:
- every API call must succeed, at the HTTP level and with `success: true`;
- existing routes are reconciled, never duplicated;
- every required exception is read back from Cloudflare before the wildcard is created;
- any mismatch aborts before the wildcard exists.

```sh
#!/usr/bin/env bash
set -euo pipefail
: "${CF_API_TOKEN:?}" "${ZONE_ID:?}"
WORKER=nibleaf-custom-domain-edge
WILDCARD='*.nibleaf.com/*'
# Every non-docs hostname from 2.2 must be listed here.
EXCEPTIONS=(www.nibleaf.com admin.nibleaf.com api.nibleaf.com storage.nibleaf.com cname.nibleaf.com)
API="https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes"

cf() { # cf METHOD URL [JSON]: fails on HTTP errors and on success != true
  local out
  out=$(curl -fsS -X "$1" -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' "$2" ${3:+--data "$3"}) \
    || { echo "ABORT: $1 $2 failed at the HTTP level" >&2; exit 1; }
  jq -e '.success == true' >/dev/null <<<"$out" || { echo "ABORT: $1 $2 returned: $out" >&2; exit 1; }
  printf '%s' "$out"
}
routes() { cf GET "$API" | jq -c '[.result[] | {id, pattern, script: (.script // null)}]'; }

current=$(routes)
for host in "${EXCEPTIONS[@]}"; do
  pattern="$host/*"
  existing=$(jq -c --arg p "$pattern" '[.[] | select(.pattern == $p)]' <<<"$current")
  case "$(jq length <<<"$existing")" in
    0) cf POST "$API" "{\"pattern\":\"$pattern\"}" >/dev/null; echo "created exception $pattern" ;;
    1) script=$(jq -r '.[0].script' <<<"$existing")
       [ "$script" = "null" ] || { echo "ABORT: $pattern already routes to Worker '$script'; reconcile by hand" >&2; exit 1; }
       echo "exception $pattern already present" ;;
    *) echo "ABORT: $pattern has duplicate routes; reconcile by hand" >&2; exit 1 ;;
  esac
done

# Read back: every exception must exist exactly once, with no Worker.
current=$(routes)
for host in "${EXCEPTIONS[@]}"; do
  jq -e --arg p "$host/*" '[.[] | select(.pattern == $p and .script == null)] | length == 1' >/dev/null <<<"$current" \
    || { echo "ABORT: exception $host/* is missing or wrong after creation; the wildcard was NOT added" >&2; exit 1; }
done
echo "all ${#EXCEPTIONS[@]} exceptions verified"

existing=$(jq -c --arg p "$WILDCARD" '[.[] | select(.pattern == $p)]' <<<"$current")
case "$(jq length <<<"$existing")" in
  0) id=$(cf POST "$API" "{\"pattern\":\"$WILDCARD\",\"script\":\"$WORKER\"}" | jq -r '.result.id'); echo "created $WILDCARD -> $WORKER (id $id; keep it for rollback)" ;;
  1) [ "$(jq -r '.[0].script' <<<"$existing")" = "$WORKER" ] || { echo "ABORT: $WILDCARD exists with another Worker; reconcile by hand" >&2; exit 1; }
     echo "$WILDCARD already routes to $WORKER" ;;
  *) echo "ABORT: duplicate $WILDCARD routes" >&2; exit 1 ;;
esac
routes | jq -r '.[] | "\(.pattern) \(.script // "NONE")"' | sort | tee routes-after.txt
```

A route with no `script` means "no Worker". The dashboard equivalent is **Workers Routes → Add route → Worker: None**, but use the script: it does the read-back that makes this safe.

## 3. Verification
Run all of these immediately after 2.3. Any failure means **roll back** (§4).

1. **The route table** shows the wildcard plus every exception:
   ```sh
   curl -sS -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" | jq -r '.result[] | "\(.pattern) \(.script // "NONE")"' | sort
   ```
2. **Subdomain docs** still serve the same content and canonical URLs, in EN and AR. Expect `200`, `x-nibleaf-revision` present, and canonical on `https://joodpms.nibleaf.com/`:
   ```sh
   for u in 'https://joodpms.nibleaf.com/' 'https://joodpms.nibleaf.com/?lang=ar'; do
     curl -sS -D - -o page.html "$u" | grep -iE '^(HTTP|x-nibleaf-revision)'
     grep -o '<link rel="canonical"[^>]*>' page.html
   done
   ```
3. **Every excepted host** answers exactly as before: compare the status and the `server`/`content-type` headers with a capture taken before 2.3. In particular, `storage.nibleaf.com` must still serve an existing public object, and `admin.nibleaf.com/sign-in` must still return 200.
4. **The Worker actually serves subdomains.** In Cloudflare → Workers → `nibleaf-custom-domain-edge` → **Observability** (logs are enabled at 10% sampling), filter by host `joodpms.nibleaf.com` and confirm requests appear within a few minutes.
5. **On the next deploy** (or a planned origin restart), `https://joodpms.nibleaf.com/` shows the branded maintenance page, with `x-nibleaf-edge: unavailable; reason=…`, rather than Traefik's page:
   ```sh
   while true; do curl -s -o /dev/null -w "$(date -u +%T) %{http_code} %header{x-nibleaf-edge}\n" https://joodpms.nibleaf.com/; sleep 1; done
   ```
6. **Rate limiting still identifies visitors.** Before and after, the reader's IP in API logs must be the visitor's, not a Cloudflare address. It travels in `x-forwarded-for`, which the Worker forwards unchanged, together with the `TRUSTED_PROXY_HOPS` setting. If every reader suddenly shares one bucket, roll back and report.

## 4. Rollback
Delete the wildcard route; the exceptions are harmless and can stay or go:
```sh
curl -sS -X DELETE -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes/<wildcard-route-id>" | jq '.success'
```
Then compare the table with `routes-before.json`. Traffic returns to the direct origin path within seconds, and nothing else changed.

## 5. Approval checklist for the owner
- [ ] The exception list (2.2), including the decision on `docs.nibleaf.com`.
- [ ] An API token scoped to Workers Routes (edit) and DNS (read) on `nibleaf.com` only.
- [ ] The Worker's active version includes #433 before the wildcard is added.
