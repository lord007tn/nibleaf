# Nibleaf brand assets

The Nibleaf mark is the **Reversible Source**: one continuous `N` that reads the same after a half turn. It represents the product's reversible path between visual editing and source Markdown.

## Core mark

The source geometry uses a `512 × 512` view box:

```svg
<path
  d="M148 368V144L364 368V144"
  fill="none"
  stroke="currentColor"
  stroke-linecap="square"
  stroke-linejoin="round"
  stroke-width="88"
/>
```

Do not redraw, rotate, outline, add a shadow, or place another symbol inside the mark.

## Color and backgrounds

| Token | Hex | Use |
| --- | --- | --- |
| Ink | `#181612` | Mark and wordmark on light surfaces; dark tile/background |
| Paper | `#FBF7EE` | Mark and wordmark on dark surfaces; light background |
| Paper 2 | `#EEE4D3` | Quiet supporting surfaces |
| Umber | `#8A4B2E` | Editorial accent, not the core mark |
| Copper | `#B96A3D` | Small supporting accent only |

- On white, Paper, or another light background, use `nibleaf-icon.svg` or `nibleaf-logo-horizontal-ltr.svg`.
- On Ink or another dark background, use `nibleaf-icon-reverse.svg` or `nibleaf-logo-horizontal-ltr-reverse.svg`.
- Use filled tiles for compact product UI marks and where the container is outside our control: favicon, installed app icon, and social avatar.
- Keep clear space around the standalone mark equal to at least half its vertical stroke width.

## Asset families

- `nibleaf-icon*.svg`: standalone marks for light, dark, monochrome, and current-color contexts.
- `nibleaf-logo-horizontal*.svg`: navigation, README, partner, LTR, and RTL lockups.
- `nibleaf-logo-stacked*.svg`: light, dark, transparent, monochrome, and Arabic presentation lockups.
- `nibleaf-wordmark*.svg`: wordmark-only placements.
- `nibleaf-sidebar-lockup*.svg`: compact product and documentation navigation.
- `nibleaf-app-icon.svg`, `nibleaf-favicon.svg`, `nibleaf-social-avatar.svg`: controlled-background square assets.
- `nibleaf-og-card*.svg`: English and Arabic social cards.

Raster exports, ICO files, PWA icons, and public copies are generated from these sources with:

```powershell
./scripts/export-brand-raster.ps1
```

Commit the SVG sources and generated files together. Visually check the favicon at `16 × 16`, both social cards at `1200 × 630`, the app icon, and the light/dark horizontal lockups before release.
