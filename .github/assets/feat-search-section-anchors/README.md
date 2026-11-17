# Section anchors at index time

A citation of a repeated heading now opens the right section.

## The demo page

`demo-page-en.md` and `demo-page-ar.md` describe an "Install the command-line tool" page with the same **Install**
(«التثبيت») heading under macOS, Windows and Linux. That pattern is common in real docs. The reader renders those
headings with the ids `install`, `install-1` and `install-2`.

## How the citations were computed

`computed-citations.json` was produced by the real code: `chunkSearchDocument` with the page's `readerSections` (the
shared parser the reader's renderer uses), then `publishedSections`, then `validateCitedAnswer`. It was regenerated
after the council fixes, with identical results. The cited chunk is the Windows install step (`winget`).

- **Before:** the same chunks without their index-time anchor, which is how every existing index reads today. They
  resolve by heading text, as main's `withSectionAnchors` does, so they get the first matching id: `#install`
  («التثبيت»), the macOS section.
- **After:** the chunk's anchor recorded at index time: `#install-1` («التثبيت-1»), the Windows section.

## How the media was made

The site was published on an isolated local stack, taken under the shared lock and released right after. The page's
DOM ids were checked against the rendered HTML.

No AI provider key is configured locally, so there are no live answers. A final event carrying the computed
citations was replayed into the real panel, and its source link was clicked. `landings.json` records where each
click went.

- `*-before-2-opened`: lands on macOS's Install (`brew install nibleaf`), the wrong place.
- `*-after-2-opened`: lands on Windows' Install (`winget install Nibleaf.CLI`). The page's TOC highlights
  *Windows › Install*.
- `en-1440-light-after-1-answer`, `ar-390-light-after-1-answer`: the answer with its source before the click.
