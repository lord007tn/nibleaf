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
  are unchanged. Shipment stays open until new release assets and fresh-install,
  analytics-health/dashboard and concurrent-migration smoke tests exist.
- #335: corrected proxy comments and moved the unchanged parser into shared code
  consumed by app and API. Tests cover CDN, multiple public proxies, trailing
  Docker/private hops, internal-only chains, and an excessive trust count.
- #329: shared HTML caching remains disabled. EN/AR guidance records the owner
  decisions and deterministic-render/hash/CDN tests still needed. This issue stays
  open; no CDN configuration, hash CSP or deterministic rendering is claimed.

## Checks

- `pnpm typecheck`: 27 tasks passed. Subsequent CLI validation changes also passed
  the focused CLI typecheck.
- `pnpm lint`, `pnpm check:dead-code`, `pnpm release:check`, `pnpm self-host:check`,
  `pnpm docs:check`: passed. Release checks include real Docker Compose rendering
  with non-default dummy export/MCP settings and fail-closed source-CI fixtures.
- CLI: 21 tests passed; app server/release integrity: 41; server IP: 17;
  shared proxy compatibility: 7. Release-check Node tests: 22 passed.
- `BUNDLE_ANALYZE=true pnpm build:app` and app `bundle:check`: passed;
  public docs 340.24 KiB gzip against 341.50 KiB budget.
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
  synthetic auth-cookie requests returned 200, private/no-store and distinct
  CSP nonces with nonce metadata. Sign-in did not pass production configuration
  validation in this minimal process (no production auth secret); its nonce/cache
  behavior is covered by the app tests. The owned process was stopped.
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
