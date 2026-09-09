# Publishing showcase width verification

Captured 2026-09-09 using the actual homepage components/styles in a local component harness with synthetic public data. This is browser layout proof, not a full-stack test. Before uses unchanged 5ac76b source; after adds grid-cols-1 to ShowcaseRow.

| Viewport | Before document width | After document width |
| --- | --- | --- |
| 320 | 343 | 305 |
| 390 | 375 | 375 |
| 1440 | 1425 | 1425 |

The browser reserves 15px for its vertical scrollbar. The corrected document fits the available client width. Before-320 shows the horizontal scroll and clipped section; after-320 and preview-after-320 show the text and publishing preview fitting. Desktop retains two columns. Static screenshots adequately show this layout-only correction; no interaction changed.
