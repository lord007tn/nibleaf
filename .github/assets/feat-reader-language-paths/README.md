# Published language path evidence

Fictional Tidewater fixture, captured locally on 2026-11-14. The `before`
source was `77c679ec0`; the existing `after` screenshots/recording were captured at the initial PR
implementation (`051931cbb`, preceding `0df1cd3de`). They are retained as
ordinary EN/AR migration evidence, not a new capture of the review fixes.
The API mock uses port 4410 and Vite uses port 4310. No database or provider
services were used. Both local servers were stopped and the owned shared lock
was released after capture.

| Language | Before | After |
| --- | --- | --- |
| English | [Screenshot](before-en.png), [SSR tags](before-en-ssr.txt) | [Screenshot](after-en.png), [SSR tags](after-en-ssr.txt) |
| Arabic | [Screenshot](before-ar.png), [SSR tags](before-ar-ssr.txt) | [Screenshot](after-ar.png), [SSR tags](after-ar-ssr.txt) |

The screenshots are evidence sheets containing the unmodified viewport capture,
its observed Playwright URL, and unmodified SSR tag excerpts. The labeled URL is
not Chrome's native omnibox. See [before.json](before.json) and
[after.json](after.json) for exact URLs and assertions. Both runs used the repo's
`withLocalOnlyBrowser`; each recorded zero outside-network attempts.

The [20-second recording](navigation.webm) includes the Arabic old-link redirect
and a client-side pager navigation retaining `/ar/`. The pager issued zero
additional document requests. The old URL's `tab=cli` query and
`#what-you-can-build` fragment survived the HTTP 308.

[headers.txt](headers.txt) contains actual `curl.exe -sSI` output for the 16
platform/custom-domain, English/Arabic, default/v2 version, HTML/Markdown
combinations (trailing line whitespace normalized). The custom fixture host is `docs.localhost`, supplied as a Host
header to the local app. [custom-ar-ssr.txt](custom-ar-ssr.txt) records its
Arabic SSR metadata. Production DNS, CDN caching and deployed behavior were not
tested.

The review revision adds [collision-headers.txt](collision-headers.txt), real
curl output for `/ar/guide?lang=ar&tab=cli` becoming
`/~lang/ar/ar/guide?tab=cli` on the collision fixture. Focused resolver tests
compare page IDs and versions with main's unchanged lookup. SSR/document tests
cover escaped prefixes and `/ar/??lang=unknown`; route tests cover private
redirect cache isolation. The updated runner adds collision and unknown-query
screenshots. A fresh browser rerun was deferred: the shared lock was owned by
another builder and later RAM checks were below the 5 GB capture gate. The
existing screenshots do not claim runtime coverage of those added cases.

Reproduce under the required shared dev-stack lock and resource gate:

```sh
node scripts/site-preview-mock.mjs --port 4410
# In apps/app:
VITE_API_URL=http://localhost:4410 npx vite dev --port 4310 --strictPort
# From the repository root, with CHROME_PATH pointing to installed Chromium:
pnpm test:reader-language-paths:browser after
```

Run `before` only against the named baseline source. The `after` runner asserts
200 SSR responses, fragment inheritance and prefix retention during client
navigation; its output is intended for review, not production analytics.
