# Reader deferred controls (real browser)

Checks in Chromium that the published reader's deferred controls respond to the
reader's first action while their code is still downloading:

- Enter and Space on the header language trigger;
- a tap on the phone menu button;
- a failed download, which is announced, then a retry that opens the menu.

Each scenario uses a fresh browser context and holds the control's chunk back
with `page.route`, then lets it through and checks the control opened.

It needs a production build of the app and the dependency-free public site mock.
No database or real API is involved.

```sh
pnpm turbo run build --filter=@nibleaf/app
node scripts/site-preview-mock.mjs --port 4311 &
(cd apps/app && PORT=4310 node .output/server/index.mjs) &
pnpm test:reader-deferred-controls:browser [videoDir]
# stop both servers afterwards
```

Set `CHROMIUM_PATH` if Chromium is not at Playwright's default Windows install
path, and `APP_URL` or `SITE_ID` to target another app origin or mock site.
