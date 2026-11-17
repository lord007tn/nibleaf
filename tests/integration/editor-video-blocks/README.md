# Editor video blocks (real browser)

Checks in Chromium that a writer can add a YouTube video from the editor and
publish it, and that nobody contacts the provider before play (AUTH-11, PR 2):

- typing `/video` (`/فيديو` in Arabic) lists the Video block first; Enter
  inserts it with the address field focused;
- an address the block can't play shows the inline error; a YouTube link is
  stored as its canonical `youtube-nocookie.com` player, and Tab moves to the
  required title;
- the start time (read from the link's `t=30`) and a caption are set, and the
  page saves `<Frame caption>` around `<iframe src title></iframe>`;
- the editor shows the reader's click-to-load poster in a 16:9 box, with no
  iframe, and the page doesn't scroll sideways;
- a page imported from Mintlify (`<Frame>` around a multi-line `<iframe>`) opens
  as the block and is left unchanged;
- after publishing, the published page shows the facade, named "Play video: …
  (loads from YouTube)", right to left in Arabic; play loads exactly one player.

The request log has **no request off localhost at all** in the editor, while
publishing, or in the reader before play; the only one after play is the mocked
player. The browser comes from `withLocalOnlyBrowser` (`../lib/capture-env.mjs`):
default-deny at Chromium's network layer, with only the app (`localhost:4310`)
allowed. The provider and `example.com` hosts are answered in-process by this
script's `route` mocks (as in the #547 check), so nothing leaves the machine; any
attempt to reach outside the stack (requests, sockets, redirects) fails the run,
and the count (0) is written to `request-log.json` as `outsideAttempts`. The
reader is opened only for sites this script creates, which have no custom domain
(no domain rows, `primaryDomain` null, both checked), and only at
`http://localhost:4310/sites/<id>/…`. The save is checked once it has settled:
the editor says the draft is saved, and the stored source holds the final title
and caption across two reads.

It runs in English and Arabic at 1440 and 390 pixels wide, and writes the
screenshots and `request-log.json` to `.github/assets/feat-editor-video-blocks/`.

## Running it

It needs the real built app and API, the demo seed in a **disposable** database
whose name contains `video_blocks` (set as `NIBLEAF_CAPTURE_DATABASE`, equal to
the database in `POSTGRES_URL`), and its own Redis database number. The root
`.env` must set `API_PORT=4410`. The script listens on nothing itself: it starts
the app on 4310 and the API on 4410, and works the publish queue in its own
process with the worker's processors, so no worker port is opened.

It takes the machine-wide dev-stack lock (`NIBLEAF_DEVSTACK_LOCK`) before
starting anything, checking every 2 minutes while another run holds it, and
stops its servers, browser and workers and releases the lock however it ends.

```sh
pnpm turbo run build --filter=@nibleaf/app --filter=@nibleaf/server
NIBLEAF_DEVSTACK_LOCK=/path/to/devstack.lock NIBLEAF_CAPTURE_DATABASE=nibleaf_editor_video_blocks \
  pnpm test:editor-video-blocks:browser
```

To capture main for comparison in the same run, set `NIBLEAF_BEFORE_APP` and
`NIBLEAF_BEFORE_API` to main's built app and API entrypoints (keep each next to
its package, for example `apps/app/.output-before/server/index.mjs` and
`apps/server/dist-before/index.mjs`). The before phase checks that main has no
Video block, records a pasted video link staying a link, and the imported page
showing nothing where the video is.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (or `CHROME_PATH`) if Playwright's Chromium
is not installed. The fictional sites stay in the disposable database; drop it
when done.
