# Mermaid 12 compatibility evidence

Captured November 2, 2026 in the owner's personal Chrome profile using the actual
MermaidBlock component and synthetic diagrams in a local review harness.
These captures are local source acceptance, not production deployment evidence.
The screenshots and bundle measurement below belong to the isolated Mermaid
upgrade. The replacement dependency PR records fresh checks of the combined graph.

- [Flowchart at 390px](mermaid12-mobile.jpg)
- [Dark theme](mermaid12-dark.jpg)
- [Invalid syntax fallback at 390px](mermaid12-invalid-mobile.jpg)
- [Hostile label after strict sanitization](mermaid12-sanitized.jpg)

The review exercised flowcharts, class/state diagrams, Arabic labels, light/dark
re-rendering, accessible diagram titles/descriptions, keyboard focus and malformed
syntax. Hostile labels produced no script, event attributes, javascript URLs or
payload execution. Invalid syntax showed the existing raw-source fallback without
orphan SVG nodes. At 390px the document did not overflow; diagrams retain their
own horizontal scroll region.

Explicit dagre/classic options preserve the intended layout and style. Mermaid 12
still makes short-label nodes wider than v11, so this is not pixel parity. There
is no new interaction; screenshots show the static SVG and both existing themes.
The hostile-label image deliberately contains a broken synthetic image label.

Validation on Node 22.23.4: 38 existing Markdown/sanitization tests, app typecheck,
Biome and the complete production app build passed. The bundle check measured
344.76 KiB gzip against its 380.86 KiB budget. No permanent test harness, CI job,
customer content, browser state or credentials were added for this review.
