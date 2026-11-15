# Dashboard toasts on phones: clear of Save and Discard

**Local component fixture. This is not the signed-in dashboard, not production, and not a physical phone.** Before
(`main@9fe273ca`) and after (`5a06f9db`) captures. They use the real `AppProviders` (Sonner's toast host), the real
SaveRegion and the real Site settings → Analytics form, in a stand-in dashboard frame: a sticky 48px header and the
`PageContainer` column. The site is fictional. "Before" swaps in main's `app-providers.tsx` and nothing else. A third
phase, `after-703`, also swaps in PR #703's deferred toast host (`e8b7b6a3`) and is measured but not screenshotted.

How they were made (`capture.mjs`):

- A temporary Vite build of the fixture runs in local headless Chromium through `tests/integration/lib/capture-env.mjs`,
  which holds the dev-stack lock and keeps the browser local-only. 0 requests left the fixture origin.
- The form's only request, the config `PATCH`, was answered by interception: a network failure, then 409, then 500,
  then success.
- Phone layouts emulate touch (`hasTouch`, `isMobile`).
- **The on-screen keyboard is simulated.** `visualViewport.height` is overridden to 55% of the window and a `resize`
  event is dispatched, which is what makes the SaveRegion dock. The layout viewport does not change, and no keyboard
  is drawn. In the docked sheets, the dashed line marks the top of the simulated keyboard. The form ends with the bar,
  so the page cannot scroll it above that line. A phone would pan the visual viewport to show it.

Each PNG shows **light** (left) and **dark** (right) side by side, except the 320 and 844×390 sheets, which are light
only.

| Files | What it shows |
| --- | --- |
| `error-floating-{before,after}-{en,ar}-390.png` | One failed save: the long network error wraps to two lines. Before, it sits on Save and Discard. After, it is at the top. |
| `stacked-floating-{before,after}-{en,ar}-390.png`, `…-en-320.png` | Three failed saves (network, 409, 500), with the stack expanded the way a touch or pointer expands it. Before, they cover the bar. After, they stack down from the top. |
| `stacked-docked-{before,after}-{en,ar}-390.png`, `…-en-320.png` | The same three errors after going back into the field: simulated keyboard open, bar docked at the end of the form. |
| `stacked-floating-{before,after}-{en,ar}-1440.png` | Desktop: identical before and after (bottom-right in EN, bottom-left in AR). |
| `stacked-floating-{before,after}-en-844x390.png` | A phone held in landscape: Sonner's desktop layout, wider than its 600px phone breakpoint. Before, the toasts cover the bar. After, they are at the top. |
| `retry-after-{en,ar}-390.webm` | A tapped flow (light): edit, tap Save, the request fails, the error shows at the top and the edit is kept, correct the id, tap Save again, saved. |

`evidence.json` has 106 measurements (5 layouts × locales × themes × 3 phases × 4 scenes). For each one it records:

- the boxes of every visible toast, the bar, Save and Discard, and whether any toast overlaps either control;
- `elementFromPoint` at the centre and four inset corners of each control;
- a real tap (a click at 1440) at each control's centre. A capture-phase listener records which element received it and
  stops it, so nothing is saved or discarded;
- the front toast's wrapped line count and clipping, where focus is, that the edit is still in the field, that there is
  one toast host and it sits inside the dashboard scope, page and console errors (none), and horizontal overflow
  (none).

## Checking the placement again, without media

`node .github/assets/dashboard-mobile-toast-placement/capture.mjs --verify` uses the same fixture on the current tree
only. It makes no screenshots or videos and leaves `evidence.json` and the images above untouched; it writes
`verify.json`. Run it after a Sonner upgrade. In EN and AR, at 390, 844×390 (touch, landscape) and 1440, with three
failed saves expanded, it fails with a list of problems when:

- the front toast is not at the host's own offset variable from its edge (`--mobile-offset-top` at 390, `--offset-top`
  at 844×390, plus the safe area), or at `--offset-bottom` on desktop, or a variable is empty or not a px length;
- the stack does not grow away from that edge, sits on the wrong side for the language, or there is more than one host;
- a toast overlaps Save or Discard, or a hit-test or tap at either misses it;
- on the auth pages' providers (no dashboard scope), toasts are not at Sonner's unchanged bottom, or a dashboard rule
  reaches them;
- a 390 → 1440 → 390 resize leaves the stack at the wrong edge, or unmounting leaves a host, a rule or root styles
  behind.

Sonner keeps reporting `data-y-position="bottom"` throughout: #715 moves the stack with CSS, which selects on it.
`verify.json` records the Sonner version and whether the toast host is deferred. Since #703 it loads after
hydration; each row waits for its live region before the first toast, so the rows measure that real deferred host.
The jsdom side of the same contract, reading Sonner's rendered host and its own stylesheet, is in
`apps/app/src/components/app-providers.test.tsx`.
