# Dashboard shell navigation evidence

Baseline: `origin/main@72699708` (#375). After: the shell-navigation implementation in this PR.
Captured 2026-11-08 with the supplied council seed and headless installed Chrome. The same isolated database was retained throughout. Relative times and rolling-window totals reflect each capture time.

The branch was subsequently rebased onto `d98b26bb`. All 11 shell runtime files and the 84 added translations are byte-for-byte/value-identical across that rebase; the receipt records their blob identities. Required static checks were rerun after the rebase. The browser evidence remains qualified to the recorded capture base. The final storage-only rebase to `4f70e252` preserves the entire app/design-system/i18n trees, lockfile, root scripts and Turbo config; their test/build receipts were retained, with dependency typecheck, lint and dead-code checks repeated.

The harness covered workspace/project headers, analytics Search/Pages, AI, the open mobile sidebar, notifications, and the palette in EN desktop light/dark and AR 320px light/dark: 32 before and 32 after captures. The final captures have zero console errors and zero document horizontal overflow. One after-capture navigation hit the 45-second network-idle timeout; its targeted retry passed. Both attempts are retained in [verification.jsonl](verification.jsonl).

Document overflow was also zero before the fix, despite clipped portaled popups. Direct popup bounds reproduced the defect: notifications were 360px wide and the 320px date popup extended 5px past the viewport. Both now measure 288px wide and fit inside 320px.

| State | Before | After |
| --- | --- | --- |
| Analytics breadcrumb, EN light | ![Before analytics breadcrumb](before-breadcrumbs-en-desktop-light.png) | ![After analytics breadcrumb](after-breadcrumbs-en-desktop-light.png) |
| Project header, AR 320px | ![Before project header](before-project-ar-320-light.png) | ![After project header](after-project-ar-320-light.png) |
| Notification popup, AR 320px | ![Before notification popup](before-notifications-ar-320-light.png) | ![After notification popup](after-notifications-ar-320-light.png) |
| Failed page read, EN dark | ![Before failed palette read](before-palette-error-en-desktop-dark.png) | ![After failed palette read](after-palette-error-en-desktop-dark.png) |
| Open sidebar, AR 320px dark | ![Before mobile sidebar](before-sidebar-ar-320-dark.png) | ![After mobile sidebar](after-sidebar-ar-320-dark.png) |

[15.48-second Arabic mobile interaction recording](mobile-shell-ar.webm)

## Verification

- App/design-system Turbo typecheck: 8 tasks passed.
- App suite: `pnpm --filter @nibleaf/app test --maxWorkers=4` passed all 253 files: 2,807 tests passed, 14 existing opt-in tests skipped. Default-worker runs hit cold-import timeouts in the inherited marketing and site-search tests; the focused marketing file passed 142 tests, and the four-worker full run preserved all deadlines, assertions, and test selection.
- i18n: 4 files, 132 tests passed, including catalog/key/variable parity and shell translations.
- Lint and dead-code checks passed.
- Design system has no test script; its typecheck and the app's real primitive/component/browser tests cover the changes.
- Analyzed production build and bundle checks passed. Public docs: 338.15 KiB gzip; index: 337.34 KiB; ceiling: 340.04 KiB (348,200 bytes). Module and copy boundary checks passed.
- The [headless browser regression](check-browser.test.mjs) passed with 21 recorded checks across EN/AR/DE: localized dialogs/landmarks, one current breadcrumb, site/Workspace/New site sheet dismissal, popup bounds/scroll reachability, query retry, and notification unread state plus persisted mark-read.
- Popup checks used 320×720, 320×300, and 720×450 CSS viewports. The last represents a 1440×900 window at 200% zoom; native browser zoom controls were not driven.
- Notifications stayed at four unread throughout the gallery captures. The final browser test then marked all read, verified row/bell changes, and read back zero from the API.

Run the browser test after screenshots against a fresh local council seed with four unread notifications. It requires the seeded `demo@nibleaf.test` session, rejects non-local hosts, and marks that fixture inbox read. It injects only the failing reads used to verify recovery.

```powershell
$env:BASE = 'http://localhost:4510'
$env:COOKIE_FILE = 'C:\path\to\cookies.txt' # name=value lines, as used by shots.mjs
node --test .github/assets/dashboard-shell/check-browser.test.mjs
```

The owner-approved isolated `nibleaf-dashui-gpt` infrastructure used +220 ports because +120 belonged to `nibleaf-import`. App/API/worker used 4510/4511/4512. Owned dev processes and the compose project were stopped; volumes and the fixture recovery snapshot were retained. The import stack was untouched.

Cleanup review covered the task diff against `72699708`. Recovery controls now sit outside the command listbox, and breadcrumb ancestors use exact route matching. Existing primitives/query hooks were reused; no remaining actionable cleanup findings were identified.

L1 (repeated New site deep-link intent on the already-mounted sites/index routes) remains a follow-up in the excluded files.
