# Reader page layout (real browser)

Checks in Chromium the published page's layout details that need a real cascade
and real font loading:

- an Arabic page on a phone (390 px, a slow network and a 4× slower CPU) keeps
  its layout while its web font loads: CLS stays under 0.1 (the page actions
  used to wrap under the title once Noto Sans Arabic arrived, CLS 0.20);
- the theme's title rules reach the title: Manuscript's heading face, and the
  1.3 line height of right-to-left titles;
- from 80rem the header's Ask AI entry is the only one (no floating launcher),
  and narrower screens keep the launcher;
- with a mouse, a heading's section link sits right after the heading text, in
  both directions;
- code on an Arabic page keeps its monospace face: the code block, each
  highlighted token, and inline code.

It needs a production build of the app and the dependency-free public site mock.
No database or real API is involved.

```sh
pnpm turbo run build --filter=@nibleaf/app
node scripts/site-preview-mock.mjs --port 4311 &
(cd apps/app && PORT=4310 node .output/server/index.mjs) &
pnpm test:reader-page-layout:browser
# stop both servers afterwards
```

Set `APP_URL` or `MOCK_URL` to target other origins (the app must be built with
the matching `VITE_API_URL`), and `CHROMIUM_PATH` if Chromium is not at
Playwright's default install path.
