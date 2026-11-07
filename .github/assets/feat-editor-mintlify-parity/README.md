# Foundations: one component registry and lazy reader renderers

This change is a refactor with no visible change, so the media proves that nothing moved.

## Published reader

Captured with `scripts/site-preview-shots.mjs` against `scripts/site-preview-mock.mjs` (the
fictional "Tidewater" docs): Harbor, Manuscript and Signal; light and dark; English and Arabic;
1440 px desktop and 390 px phone; the home page and the component-heavy
`guides/authentication` page (Callout, Tabs, Steps, AccordionGroup, CardGroup, Frame, code). That
makes 48 full-page screenshots on main (`ed15240e` + the dashboard-only #299) and 48 on this branch.

- 45 of 48 pairs are pixel-identical.
- The other three differ only in where a web font had finished loading when the screenshot was
  taken (bold and inline-code text in the fallback font). A second capture of this branch made one
  of them identical and moved the difference to another page, so it is timing, not layout.

The `reader-after-*.png` files here are byte-identical to their `before` counterparts, so only one
copy is kept.

| File | What it shows |
| --- | --- |
| `reader-after-{harbor,manuscript,signal}-light-en-desktop.png` | The component page in each theme, light, English, desktop. |
| `reader-after-{harbor,manuscript,signal}-dark-ar-mobile.png` | The same page in Arabic, dark, at 390 px. |
| `reader-after-harbor-en-desktop-light.gif`, `reader-after-signal-en-desktop-dark.gif`, `reader-after-manuscript-ar-mobile-dark.gif` | The renderers now load from the lazy chunk and still work: switching tabs by click and arrow keys (in the reading direction), the numbered steps, and opening an accordion. |

## Editor

Captured against an isolated local stack with the seeded demo workspace, on an English and an
Arabic sandbox page. The slash menu now comes from per-family item modules; its order is pinned
by a test and unchanged.

| File | What it shows |
| --- | --- |
| `editor-{en-desktop,ar-mobile}-1-menu.png` | Typing `/` on a new line opens the block menu. |
| `editor-{en-desktop,ar-mobile}-2-search.png` | Searching "accordion" / «أكورديون» finds the component. |
| `editor-*-3-inserted.png` | The inserted accordion group, with its title typed in place. |
| `editor-en-desktop.gif`, `editor-ar-mobile.gif` | The whole flow. |
