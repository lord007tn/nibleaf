# Reader search keystrokes (real browser)

Checks in Chromium, with real key, paste and IME events, that the published
reader's search keeps every keystroke typed while it opens. The scenarios:

- typing right after Ctrl+K;
- Arabic;
- Backspace;
- paste;
- select-all and replace;
- an IME composition that is still open when the dialog's code arrives;
- reopening, typing, then deleting everything.

Each one holds the search dialog's chunk back with `page.route`, so typing goes
through the hidden field and the loading shell before the chunk is let through
mid-typing. It then asserts the dialog field's final value, focus and caret.

It needs a production build of the app and the dependency-free public site mock.
No database or real API is involved.

```sh
pnpm turbo run build --filter=@nibleaf/app
node scripts/site-preview-mock.mjs --port 4311 &
(cd apps/app && PORT=4310 node .output/server/index.mjs) &
pnpm test:reader-search:browser [videoDir]
# stop both servers afterwards
```

Set `CHROMIUM_PATH` if Chromium is not at Playwright's default Windows install
path, and `APP_URL` or `SITE_ID` to target another app origin or mock site
(default `http://localhost:4310`, `preview-harbor`). The build fixes the API
proxy target at build time. If 4310 or 4311 is busy, build with
`VITE_API_URL=http://localhost:<mock port>` and start the app with `PORT=<port>`.

This test is not part of CI: it needs a full app build and a browser. Run it
when changing `apps/app/src/components/site/site-search*.ts(x)`. Real iOS
keyboards and screen readers are checked by hand on production after deploy.

The build before these fixes (`ff064d6a`) fails both composition checks. Its
dialog took the pre-edit `rか`, and the committed text then doubled up to `rか課e`.
