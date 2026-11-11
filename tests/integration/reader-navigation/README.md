# Reader navigation (real browser)

Checks in Chromium how the published reader moves between pages (READER-05b):

- hovering, focusing or tapping a page link on a public site prefetches it,
  and sends nothing else: no page view, search, AI or event request (a touch
  that scrolls across a link is not a tap);
- a private site is never prefetched, and a reader whose access is revoked
  mid-session sees nothing more (the mock's `preview-private` site and its
  `POST /__mock/control {"revoked": true}`);
- the click then opens the page without another request;
- the pager's next page loads once the browser is idle, and only that page;
- Back within the fresh window opens from cache and restores the scroll position;
- modified clicks and in-page anchors stay with the browser;
- a client navigation whose data was dropped by a gateway (502/503/504) or the
  network falls back to one full page load, and failing again keeps the error
  page; a refusal (4xx) or a 500 never does.

It needs a production build of the app and the dependency-free public site mock.
No database or real API is involved.

```sh
pnpm turbo run build --filter=@nibleaf/app
node scripts/site-preview-mock.mjs --port 4311 &
(cd apps/app && PORT=4310 node .output/server/index.mjs) &
pnpm test:reader-navigation:browser [videoDir]
# stop both servers afterwards
```

Set `CHROMIUM_PATH` if Chromium is not at Playwright's default Windows install
path, `APP_URL` or `SITE_ID` to target another app origin or mock site, and
`MOCK_URL` when the mock is not on port 4311 (the app must be built with the
matching `VITE_API_URL`).
