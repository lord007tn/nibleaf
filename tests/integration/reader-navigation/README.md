# Reader navigation (real browser)

Checks in Chromium how the published reader moves between pages (READER-05b):

- hovering, focusing or touching a page link prefetches it, and that never
  counts as a page view;
- the click then opens the page without another request;
- the pager's next page loads once the browser is idle, and only that page;
- Back within the fresh window opens from cache and restores the scroll position;
- modified clicks and in-page anchors stay with the browser;
- a client navigation whose data can't load falls back to one full page load.

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
path, and `APP_URL` or `SITE_ID` to target another app origin or mock site.
