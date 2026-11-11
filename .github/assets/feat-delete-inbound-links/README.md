# Delete inbound-link warning evidence

The screenshots render the real design-system confirmation and the app's
`DeletePageInboundLinks` component with fictional endpoint responses. They are
isolated UI evidence, not a signed-in end-to-end product or database test.
The before state is the existing confirmation without its new content slot.
Both states use the same current design-system styles and 30-day Trash copy.

- `before-*` / `after-*`: English and Arabic at 1440×900 and 390×844.
- `loading-*` / `error-*` / `empty-*`: deletion stays available; no stale count is shown.
- `dialog-*.gif`: actual captured frames, in order: before, loading, warning,
  request failure, empty result, warning. Each is below 5 MB.
- `layout-*.json`: Delete and footer bounding boxes in the same open dialog
  across loading, result, error, empty, long-title and restored-result states.
  The advisory reserves 18rem and scrolls internally; every coordinate must
  remain within 0.5px of its loading-state value.

All four captures measured **0px maximum movement** across those states.
At 390px, Delete stayed at `(x=27, y=591, width=336, height=36)` in both
English and Arabic. At 1440px its y-coordinate stayed at 631 in both locales.
- `*.aria.txt`: Chromium accessibility trees. The browser script asserts the
  localized warning, five named editor links, dialog name, retained Trash copy,
  initial cancel focus, viewport fit, and 44-pixel link targets.

Run `node tests/integration/delete-inbound-links/browser.mjs`. Following the
repository's design-system forced-colors harness pattern, it builds a temporary
static fixture and serves its files through Playwright request interception.
It uses headless playwright-core with the owner's installed Chromium 1248,
closes its browser and removes the owned temporary build in `finally`. It starts
no dev server or container, so it uses no stack lock and leaves the sibling's
stack and lock intact. No database, account or real user content is used. The
fixture translator uses real generated Paraglide messages for its seven keys.

The 2,200-page regression fixture has one unique Markdown body and one link to
the final page on each source. Local before measurements on reviewed head
`6c0bf2fa` were **1,508.8 ms cold / 1,763.7 ms repeat**. After the branch-map fix,
the same fixture measured **2,100.6 ms cold / 0.2 ms repeat** on the final code
(an earlier after run was 1,559.1 ms / 0.2 ms). These include
snapshot composition, parsing, route resolution and counting; database/HTTP
latency is excluded (database calls use deterministic fixtures).

Only the target branch's bodies are read. A metadata-only fingerprint of page
IDs, MVCC row versions (`xmin`), timestamps and structure, together with project
configuration, language/version metadata and trusted aliases, invalidates the
map on edits, moves, deletions, restores and redirect/domain changes. Cached
maps contain only capped summaries/counts and are bounded to eight branches
and 10,000 total pages. Concurrent requests reuse the pending scan. Scans
larger than the 2,000-entry content-facts cache reuse hits without inserting
misses, so they cannot sequentially evict it. Per-scan route memoization stays.

The inbound advisory accepts HTTP(S) and protocol-relative links on the shared
default-subdomain host and verified custom domains, including normalized host
case and default ports. Full URLs keep their own version/language selection.
**Publish-check behavior is unchanged: absolute URLs remain external there.**
