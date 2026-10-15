# Product readiness audit — 15 October 2026

This evidence uses a compiled production app with a synthetic local workspace,
local API/worker processes, and Docker PostgreSQL 17, Dragonfly, ClickHouse, and
object storage. It does not establish deployed customer or external-provider acceptance.

## Fixed flows

- Serialize page saves, preserve intentional empty bodies, and flush the newest
  draft before page/branch navigation, preview, and publish. Failed saves retain
  the draft, block publication, and offer Retry.
- Preserve unsaved configuration across refetches; confirm before leaving it.
  Require saved configuration before preview/publish, and cancel pending publish
  preparation when its dialog closes. Pass subscribed values to shared controls
  so optimized production builds can save a reversion to the original value.
- Keep mobile page settings and publish review usable; restore keyboard focus
  when the focused Markdown navigation closes. Destructive confirms focus Cancel.
- Recover from signup metadata, dashboard, usage, and invitation failures.
  Preserve unknown metrics, offer clear-search recovery, and provide invited-account
  switching. Confirm member removal and invitation revocation.
- Match project settings/export scheduling controls to the server's role rules.
- Restore mobile reader links/CTA, language/version-aware navigation, accessible
  search states, Arabic/RTL search, and close controls. Denied browser storage no
  longer crashes reader banners, theme, consent, or first-publish attribution.
- Prevent account/Sites hydration mismatches and keep mobile email actions inside
  their card. Repair the local passwordless demo seed and its documentation.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm check:dead-code` pass.
  The full test run completes 24 Turbo tasks; app: 601 tests; API: 503 tests;
  i18n: 83 tests. Optional integration tests skipped in the ordinary suite were
  exercised separately where infrastructure was available.
- Production app and admin builds pass. Public docs preload budget: 380.11 KiB
  gzip against 380.86 KiB. No budget increase or automatic Docker build was added.
- PostgreSQL: all 30 migrations, runtime, add-on/integration/MCP forward/rollback
  smokes, tenant fencing (3), and concurrent publish receipts (2) pass against a
  separate disposable database.
- ClickHouse: migrations and idempotence pass; all 29 integration tests pass.
- Documentation, self-host integrity, release contract, SSR CSP nonce checks,
  and malformed-path HTTP 400 checks pass for app/admin.
- Browser route sweep: 60 desktop/mobile checks, including every project settings
  section. All document responses 200, no horizontal overflow. Two hydration
  defects were fixed; 12 additional repeated hard navigations, including a clean
  cookie-only auth context, have zero page/console/HTTP errors or overflow.
  Rapid navigation caused two background session-rate-limit responses during the
  initial sweep; both surfaces remained usable.
- Interactive local acceptance: OTP sign-in; empty-body save/reload; rapid
  page switches; failed-save retry; immediate edit/publish through worker READY
  to matching reader content; configuration discard/save/SEO clearing; English
  and Arabic mobile navigation/search; signup metadata retry; denied storage;
  and real missing-page HTTP 404.
- Final compiled-browser checks also confirm configuration blocks stale preview
  and publication, Cancel during delayed preflight creates no deployment, and an
  A-to-B save followed by reversion to A persists to the API. Immediate publication
  succeeds through worker READY with both browser storage getters denied.

## Visual evidence

| Flow | Evidence |
| --- | --- |
| Failed save keeps draft and provides Retry | [Screenshot](editor-save-failure-recovery.png) |
| Editing and publishing interaction | [Recording](editor-save-publish.webm) |
| Publishing with browser storage denied | [Recording](editor-publish-storage-denied.webm), [success](publish-storage-denied-success-mobile.png) |
| Configuration discard defaults to Cancel | [Screenshot](config-discard-cancel-focus.png) |
| Mobile page settings | [Screenshot](page-settings-mobile.png) |
| Mobile publish review | [Screenshot](publish-review-mobile.png) |
| Account email layout | [Before](account-mobile-before.png), [after](account-mobile-after.png) |
| Mobile reader navigation | [English](reader-mobile-menu-en.png), [Arabic](reader-mobile-menu-ar.png) |
| Navigation and search interaction | [Recording](reader-mobile-navigation-search.webm) |
| Arabic search | [Screenshot](reader-search-ar.png) |
| Arabic search with storage denied | [Screenshot](reader-storage-denied-ar.png) |
| Signup metadata outage recovery | [Screenshot](signup-metadata-retry-mobile.png) |

Only synthetic local demo content appears in these assets. Authentication state,
credentials, environments, database dumps, and raw provider logs stay untracked.

## Production release remains open

Tracked separately in [#193](https://github.com/lord007tn/nibleaf/issues/193).
Public probes returned 200 but reported different revisions:

| Service | Observed source revision |
| --- | --- |
| App | `5ac76b40619a7903477d31fec14f456fcc50c95f` |
| API | `3887db28700e6d2a9a849186ba72a5e651ebd314` |
| Admin | `01ea140d5e4ddf31f743ccc5d2eabf6f6710241a` |

The read-only Coolify diagnostic completed successfully in
[run 38793996699](https://github.com/lord007tn/nibleaf/actions/runs/38793996699).
It does not prove current backup/restore safety or immutable running-image pins.
A current verified backup/restore reference, proven rollback revision, aligned
manual deployment, and authenticated production acceptance are still required.
External email delivery, payment, OAuth/provider approval, and customer data
changes were not exercised by the synthetic local suite.
