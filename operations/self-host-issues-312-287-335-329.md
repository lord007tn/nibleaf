# Self-host validation, 2026-11-08

Base: `origin/main` at `88daac87f2abcbe38910e508a62abc83d219a39d`.
All four issues and their comments were read and rechecked at this revision.
None was fully fixed. This record is local/source evidence, not a deployment.

## Changes and limits

- #312: removed the unsafe restore shortcut, aligned EN/AR restore instructions,
  rejected unusable CLI resources, and gated manual publication/deployment on
  exact-SHA source CI. The three required workflows match protected-main checks:
  CI, CodeQL and secret scanning. No override is provided.
- #287: prepared analytics and export/MCP limits in the next-release templates.
  `release/published/` preserves the prior inputs; manifest and published hashes
  are unchanged. The template is the next release Compose, with analytics optional via its
  profile and flag. Public v0.2.1 assets remain unchanged.
- #335: corrected proxy comments and moved the unchanged parser into shared code
  consumed by app and API. Tests cover CDN, multiple public proxies, trailing
  Docker/private hops, internal-only chains, and an excessive trust count.
- #329: the owner accepted hash CSP and the GTM/crawler/staleness trade-offs.
  Anonymous allowlisted marketing documents now use completed deterministic
  rendering, normalized router timestamps and build-fixed stars/year, with hashes
  computed after the manifest rewrite. Cookies, Authorization and query strings
  bypass sharing. Dashboard and reader nonce CSP remains unchanged. CDN rules
  are documented; no live CDN rollout is claimed.

## Checks

- `pnpm typecheck`: 27 tasks passed. Subsequent CLI validation changes also passed
  the focused CLI typecheck.
- `pnpm lint`, `pnpm check:dead-code`, `pnpm release:check`, `pnpm self-host:check`,
  `pnpm docs:check`: passed. Release checks include real Docker Compose rendering
  with non-default dummy export/MCP settings and fail-closed source-CI fixtures.
- CLI: 21 tests passed; app server/release integrity: 41; server IP: 17;
  shared proxy compatibility: 7. Release-check Node tests: 22 passed.
- `BUNDLE_ANALYZE=true pnpm build:app` and app `bundle:check`: passed;
  public docs 340.25 KiB gzip against 341.50 KiB budget.
- A negative fixture against original `main` accepted HTML `llms.txt` plus an
  arbitrary OpenAPI string; the repaired inspection rejected both. Additional
  fixtures cover EN/AR UTF-8, malformed JSON, document shape and supported versions.
- `SELF_HOST_RESTORE_DRILL=1 node --test scripts/self-host-restore.test.mjs`:
  passed with owned project `nibleaf-selfhost`, PostgreSQL 17 and no host ports.
  A fictional Arabic row and pre-migration schema survived dump/restore; the
  original post-migration database remained intact. Occupied-target restoration
  failed. No app was started; the owned fixture was removed afterward. This is a
  representative FK/schema boundary drill, not a production-backup restoration.
- Live installed-h3 `proxyRequest` without `xfwd` preserved a synthetic forwarded
  chain byte-for-byte at an owned HTTP upstream on port 4451. The generated Nitro
  API route has no `xfwd` option. No existing processes were stopped.
- Built-app HTTP checks on port 4450 passed for `/` and `/ar`: anonymous and
  synthetic auth-cookie requests returned 200 with distinct nonce policies before
  the accepted marketing change. The final built-app marketing guard separately
  passed all seven EN/AR URLs with byte-identical human/bot HTML, 7-9 covered inline
  scripts per page, no nonce metadata and credential bypass. Sign-in without a
  production auth configuration was not an end-to-end auth test. The owned process
  was stopped.
- Downloaded public v0.2.1 assets independently matched the existing manifest:
  Compose `1fa726f217dd864619a23011eaa1dabe82853ed09b812ce02954e1d247a3a486`;
  installer `b653c9e51106ff0d6778ad65163ebbed08c57c5dbc7c2ac869a31e9c32778032`.
- Read-only source-CI dry run at the base SHA returned success for runs
  `42508074113` (CI), `42508074167` (CodeQL), `42508074111` (secret scanning).
  It built, published and deployed nothing.

Local tools were Windows, Node 26.13.0, pnpm 10.34.9 and Docker 29.8.1. PR CI
uses Node 22 and runs the Linux installer fixtures; those shell fixtures skip on
Windows. New-release installation remains a separate release gate.

## Cleanup and visual evidence

The `ai-slop-cleanup` pass covered this task's complete diff against the base.
Removed the duplicate parser and a copied unrelated Compose comment; tightened
CLI validation without rejecting Markdown that merely mentions HTML tags. No
remaining actionable slop found. Published-input duplication is intentional:
it separates immutable downloads from future templates.

Screenshots/video do not meaningfully verify these CLI, header, restore and
packaging contracts. There is no visual layout or interaction change. The
executable regressions, bilingual documentation check and receipts above are the
equivalent evidence. CI/review results belong to the final PR head.

## Accepted completion scope

The coordinator instructed completion of #287 and #329 in this PR. Both are now
implementation work, rather than deferred decisions. The CDN cache rule must
bypass any Cookie/Authorization/query and vary the key by host and Accept; it
remains an operator rollout step, separate from source cacheability. Stars can
be supplied at build time through MARKETING_GITHUB_STARS; 0 is the unavailable
count fallback and the footer year is fixed in the same build snapshot.
