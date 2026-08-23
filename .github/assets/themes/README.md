# Nibleaf themes visual evidence

This evidence was captured from the local production-shaped publish pipeline against a bilingual representative documentation project. Each image is a full-page browser capture after a READY local deployment. The capture asserted the expected `data-theme-id`, `data-theme-shell`, appearance class, language direction, viewport, and zero document-level horizontal overflow before writing the file.

## Template-provider follow-up

After the reader, project preview, settings preview, and page-outline composition moved into the registered React documentation templates, the published Manuscript fixture was captured again through the real app and public API. The desktop receipt asserted `data-documentation-template="manuscript"`, `data-documentation-layout="manuscript-editorial"`, a 192 px horizontal chapter deck above the article, and zero page overflow. The mobile receipt asserted a 390 × 844 viewport, Arabic `dir="rtl"`, the same registered template/shell, hidden desktop-only deck and outline, and zero page overflow.

- [Post-refactor Manuscript desktop provider receipt](./manuscript-provider-desktop.png)
- [Post-refactor Manuscript Arabic mobile provider receipt](./manuscript-provider-ar-mobile.png)

The existing 24-view matrix remains the visual-regression baseline for all three themes. The provider follow-up is intentionally representative because the registry refactor preserves the existing visual contract; automated static-render tests independently assert the distinct Harbor, Manuscript, and Signal reader/page structures and shell overrides.

The 67-second [structural themes recording](./theme-structures.webm) shows all three shell selections, live customization, Arabic RTL preview, draft save, and the published Manuscript reader. The 97-second [workflow recording](./theme-workflow.webm) shows deterministic export, validated replace-preview import, applying to the draft, English/Arabic preview, publish, READY status, and the resulting public page.

## Harbor

Harbor is the reference shell: a persistent library rail, centered article, and independent page outline.

| Language | Light desktop | Dark desktop | Light mobile | Dark mobile |
| --- | --- | --- | --- | --- |
| English | [capture](./harbor-en-light-desktop.png) | [capture](./harbor-en-dark-desktop.png) | [capture](./harbor-en-light-mobile.png) | [capture](./harbor-en-dark-mobile.png) |
| Arabic RTL | [capture](./harbor-ar-light-desktop.png) | [capture](./harbor-ar-dark-desktop.png) | [capture](./harbor-ar-light-mobile.png) | [capture](./harbor-ar-dark-mobile.png) |

## Manuscript

Manuscript is the editorial shell: a horizontal chapter deck above a focused reading column, with an adaptive one-item Arabic deck.

| Language | Light desktop | Dark desktop | Light mobile | Dark mobile |
| --- | --- | --- | --- | --- |
| English | [capture](./manuscript-en-light-desktop.png) | [capture](./manuscript-en-dark-desktop.png) | [capture](./manuscript-en-light-mobile.png) | [capture](./manuscript-en-dark-mobile.png) |
| Arabic RTL | [capture](./manuscript-ar-light-desktop.png) | [capture](./manuscript-ar-dark-desktop.png) | [capture](./manuscript-ar-light-mobile.png) | [capture](./manuscript-ar-dark-mobile.png) |

## Signal

Signal is the console shell: a compact boxed library rail, wide technical article, and inline command-index outline.

| Language | Light desktop | Dark desktop | Light mobile | Dark mobile |
| --- | --- | --- | --- | --- |
| English | [capture](./signal-en-light-desktop.png) | [capture](./signal-en-dark-desktop.png) | [capture](./signal-en-light-mobile.png) | [capture](./signal-en-dark-mobile.png) |
| Arabic RTL | [capture](./signal-ar-light-desktop.png) | [capture](./signal-ar-dark-desktop.png) | [capture](./signal-ar-light-mobile.png) | [capture](./signal-ar-dark-mobile.png) |

## Admin and navigation

- [Theme gallery and guarded customization](./theme-studio-gallery.png)
- [Structural shell selector and live preview](./theme-studio-structural.png)
- [Validated import preview with proposed changes](./theme-studio-import-preview.png)
- [Arabic RTL draft preview with direction-aware navigation](./theme-preview-ar-rtl.png)
- [Arabic RTL structural preview](./theme-preview-ar-rtl-structural.png)
- [Arabic RTL mobile navigation drawer](./signal-ar-dark-mobile-navigation.png)

The representative page includes navigation, search, article metadata, semantic callouts, mixed Arabic/English code, tables, tabs, cards, long unbroken identifiers, feedback controls, and footer chrome. The screenshots are review artifacts, not claims of a deployed production release.
