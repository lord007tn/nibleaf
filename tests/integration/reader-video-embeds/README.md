# Reader video embeds (real browser)

Checks in Chromium that a published page's video embeds keep readers private
until they choose to play (AUTH-11):

- the page makes no request to YouTube, Vimeo, Loom or Wistia before play: no
  player, thumbnail or preconnect, even after lazy chunks and idle work settle;
- each video is a `<button>` named "Play video: {title} (loads from {Provider})",
  in a 16:9 box, reachable with Tab; Enter loads only that player
  (`youtube-nocookie.com`, with autoplay) and moves focus into it;
- a frame from any other site shows as a link card with its host;
- in Arabic the page is right to left and the control is named in Arabic;
- without JavaScript, each video is a link to the provider's page.

It runs on the mock's `guides/video-tour` page in English and Arabic at 1440
and 390 pixels wide. Provider responses are stubbed with `page.route`, so the
run never reaches the providers; the page's requests are still recorded.

It needs a production build of the app. The script takes the dev-stack lock (released on Ctrl+C too)
(`NIBLEAF_DEVSTACK_LOCK`), starts the dependency-free public site mock (:4311)
and the built app (:4310) itself, and stops both and releases the lock when it
ends. No database or real API is involved.

```sh
pnpm turbo run build --filter=@nibleaf/app
NIBLEAF_DEVSTACK_LOCK=/path/to/devstack.lock pnpm test:reader-video-embeds:browser [captureDir]
```

Pass `captureDir` to save a screenshot of each step. Set `CHROMIUM_PATH` (or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`) if Playwright's Chromium is not installed.

## Before/after captures

`capture.mjs` records the same page on main's build and on this build, in
English and Arabic at 1440 and 390: a screenshot of the whole article
(`page-<phase>-<lang>-<width>.png`) and `request-log.json`, which lists, for
each profile, the facades, link cards and `<video>` attributes rendered, every
off-site request before the first play, and the requests the first play made.
Like `browser.mjs`, it takes the dev-stack lock itself and starts the mock and
each app build in turn; provider and `example.com` responses are stubbed.

```sh
pnpm turbo run build --filter=@nibleaf/app   # here and in a worktree at main
NIBLEAF_DEVSTACK_LOCK=/path/to/devstack.lock NIBLEAF_BEFORE_APP=/path/to/main/apps/app \
  node tests/integration/reader-video-embeds/capture.mjs
```

Output goes to `.github/assets/feat-reader-video-embeds/`.
