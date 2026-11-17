# Reader search: real exit animation (#848)

This dedicated harness mounts the production `SiteSearch` entry and its lazily
loaded `SiteSearchDialog`, including the real parent mount/retention lifecycle, its
`useVisualViewport` retention path, design-system `Dialog` (Base UI), command
list, translations and production CSS. It is compiled in production mode with
normal motion. There are no production routes or test endpoints.
The committed fixture lives in `apps/app/tests/reader-search-viewport-exit`, so
React, TanStack and Vite use the app's existing declared workspace dependencies.
The assertion/capture runner stays under `tests/integration`; no new dependency
or root manifest change is needed.

Analytics and the search transport are substituted. The Start-only request-origin
boundary uses its production client result (`undefined`), keeping Start's server
runtime out of this standalone browser build. The transport calls
the existing dependency-free `scripts/site-preview-mock.mjs`, then supplies 30
fictional local results. Query state and reader rendering remain real. The
Dialog observer forwards the real completion callback immediately; it never
invokes it independently, changes motion, or supplies completion timing.

The existing `site-search-viewport-exit.test.tsx` remains useful isolated callback
coverage. This harness adds browser animation coverage rather than duplicating
its manually supplied callback order.

## Run

From a normal workspace installation (`pnpm install --frozen-lockfile`), complete
`pnpm --filter @nibleaf/i18n setup` and the app's dependency builds first. Build
this fixture with:

```powershell
pnpm --filter @nibleaf/app test:reader-search-viewport-exit:browser --build
```

Builds, package suites and repository checks require the owner's reserved heavy
slot on the shared workstation. Release that slot before browser capture. Set
`NIBLEAF_DEVSTACK_LOCK` to the owner's canonical machine-wide **directory**
(`editor-devstack.lock` in the shared nibleaf worktrees directory), then run:

```powershell
pnpm --filter @nibleaf/app test:reader-search-viewport-exit:browser
```

The portable repository runner requires Windows PowerShell, Node and the
workspace's Playwright Chromium/ffmpeg installation. `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
may select an installed Chromium. It starts only its own static production
harness on strict port 4310 and read-only fictional mock on 4410. If the canonical
lock exists, retry in about two minutes; occupied ports stop the run. It checks
at least 5 GiB free RAM. There is no Docker, database, real account or personal
browser profile. `withLocalOnlyBrowser` denies all non-local destinations and
fails on any attempt. The required count is zero.

`run.ps1` records its token, process IDs and creation times in a unique temporary
manifest and tracks browser descendants. Its `finally` invokes the separate
`release.ps1` before returning, including on assertion failure. Cleanup checks
process identities and the owner token, kills only its own processes, checks
ports, and removes only its own lock. No ignored helper files are required.

## Assertions and evidence

EN/LTR and AR/RTL each cover:

- Before close: `--search-height:470px`, `--search-top:96px`, computed height/top
  and settled bounds 96–566px; visible footer; a scrollable list whose last
  result can be reached inside its bounds.
- Frame sampling starts before Escape. A real mounted intermediate exit frame
  and intermediate opacity must occur, with the production 100ms animation.
  While exit is running, synthetic viewport geometry changes to 700px/12px.
  Every mounted exit sample keeps **both** 470px/96px variables and computed
  height/top until the real false completion. Zoom-transformed bounds are
  recorded separately, never used as the CSS sizing oracle.
- Real false completion followed by popup detachment and no remaining viewport
  resize/scroll listeners. A new opening uses fresh 530px/40px geometry.
- After completed closes, a new opening is interrupted while its real animation
  is still progressing. Its true completion must not have fired. Its exit still
  retains both 470px/96px values until actual false completion.

Animation progress and actual callbacks synchronize correctness. The five-second
watchdog only fails stalled tests; no fixed sleep is a correctness oracle. The
observed approximately 100ms exit allows scheduler tolerance, while computed
animation duration must be exactly 100ms.

Committed evidence under `.github/assets/reader-search-viewport-exit/` contains
`open-en.png`, `open-ar.png`, a continuous `interaction.webm` of the actual
assertion run, and `checks.json` with exact frame samples, callback times,
geometry, assertions, source revision and network-attempt accounting. These
are synthetic browser evidence, not device acceptance. This PR adds no user
interface behavior; captures make the tested production path reviewable.

## Manual device acceptance — still unverified

Device access was disabled in the earlier device inventory. Do **not** infer a
phone pass from Chromium viewport simulation. These checks remain manual after
the automation lands; master has decided the automation closes #848. No extra
issue is required for this checklist.

For **each** actual iPhone/Safari and Android/browser, in **both** EN/LTR and
AR/RTL, record:

- [ ] Exact serving revision, device model, OS version, browser/version and date.
- [ ] Continuous recording from opening search through typing with the native
  keyboard, scrolling to the last result and footer, closing, and reopening.
- [ ] Measured `visualViewport.height`, `offsetTop`, `scale`, popup computed
  height/top and visible bounds at each step (including during closing).
- [ ] Keyboard-visible page panning: footer and last result stay reachable,
  including a nonzero viewport top offset.
- [ ] Pinch zoom with `scale != 1`: record geometry/bounds and usability; this
  harness's scale is always 1 and cannot accept that behavior.
- [ ] Portrait/landscape rotation while open, keyboard up/down, closing during
  opening, and fresh geometry on reopening.
- [ ] Attach the continuous recording, measurement log and any failures. Leave
  untested rows unchecked; record browser/OS restrictions honestly.

No iPhone, Android, native keyboard, real panning, pinch or rotation pass is
claimed by the committed automation.
