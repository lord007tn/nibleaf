# Delete inbound-link warning evidence

The screenshots render the real design-system confirmation and the app's
`DeletePageInboundLinks` component with fictional endpoint responses. They are
isolated UI evidence, not a signed-in end-to-end product or database test.
The before state is the existing confirmation without its new content slot.
Both states use the same current design-system styles and 30-day Trash copy.

- `before-*` / `after-*`: English and Arabic at 1440×900 and 390×844.
- `loading-*` / `error-*`: deletion stays available; no stale count is shown.
- `dialog-*.gif`: actual captured frames, in order: before, loading, warning,
  request failure, warning. Each is below 5 MB.
- `*.aria.txt`: Chromium accessibility trees. The browser script asserts the
  localized warning, five named editor links, dialog name, retained Trash copy,
  initial cancel focus, viewport fit, and 44-pixel link targets.

Run `node tests/integration/delete-inbound-links/browser.mjs` only while this
task owns the shared editor dev-stack lock. It uses headless playwright-core
with the owner's installed Chromium 1248, starts one isolated Vite fixture on
port 4398, and closes its browser and server in `finally`. It uses no containers,
database, account, or real user content. The fixture translator uses the real
generated Paraglide messages for its seven rendered keys.

The shared cost regression uses 300 pages, with four related-page links and
one redirect into the target subtree on every source page. The target is last
in the snapshot. A local isolated run measured **214.9 ms cold / 4.8 ms warm**
(fastest of three warm runs), including content hashing, parsing when cold,
route resolution, subtree traversal, and result counting. It excludes database
I/O and HTTP overhead. The endpoint reuses the publish preflight's draft
snapshot loader, with no per-page queries. Content facts use the existing
bounded cache; normalized destinations are memoized only for one snapshot scan.
