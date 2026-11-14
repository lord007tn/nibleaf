# Reader image dimensions fixture

No dev server or database. The fixture uses the actual Markdown SSR output and
reader `typeset.css`, a 760 px article with 24 px padding, and five images with
known intrinsic dimensions. Chromium receives their SVG headers after first
paint plus a 600 ms delay. Each run uses a fresh context at 1440 or 390 x 900,
English/Arabic and light/dark. CLS is the maximum session window reported by
`PerformanceObserver`, excluding recent input. This isolates image aspect-ratio
reservation; it is not a remeasurement of the audited production site.

From the repository root in PowerShell:

```powershell
$env:IMAGE_DIMENSIONS_FIXTURE = Join-Path $env:TEMP 'nibleaf-reader-image-dimensions'
pnpm --filter @nibleaf/app exec vitest run src/components/site/image-dimensions.test.tsx --maxWorkers=1
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/integration/reader-image-dimensions/browser.mjs
```

The browser uses `withLocalOnlyBrowser`, fulfills the reserved `.test` host
in-process, checks zero outside-network attempts, and owns the shared devstack
lock for its duration. All contexts close and the lock releases on completion.
Screenshots and raw measurements are saved under
`.github/assets/perf/reader-image-dimensions/`. The fixture contains no motion or
interactive changes; SSR/hydration consistency is covered by the unit test.
