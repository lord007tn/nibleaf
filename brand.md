# Nibleaf Brand Assets

Nibleaf is the production brand for this project. The identity is built around ink, ivory paper, composed technical publishing, and warm umber/copper accents that work in both Arabic and English UI without a cold cast.

## Core Palette

| Token | Hex | Use |
| --- | --- | --- |
| Paper | `#FBF7EE` | Warm marketing/background surface |
| Paper 2 | `#EEE4D3` | Secondary surface and quiet bands |
| Ink | `#181612` | Primary text, dark surfaces, monochrome mark |
| Ink 2 | `#4E453A` | Softer text |
| Border | `#DED2C0` | Lines and quiet dividers |
| Nibleaf Umber | `#8A4B2E` | Primary brand mark and calls to action |
| Warm Umber | `#D18A54` | Dark-mode primary/accent |
| Copper | `#B96A3D` | Editorial accent, highlights, social art |
| Date | `#5D3928` | Warm secondary accent |

## Asset Locations

The marketing app owns the full public brand kit:

- `apps/www/public/brand`

Raster exports live under:

- `apps/www/public/brand/raster`

Root browser/app icon files are written to both public app roots:

- `apps/www/public`
- `apps/app/public`

## SVG Assets

| Asset | File | Use |
| --- | --- | --- |
| Core icon | `nibleaf-icon.svg` | Compact UI mark, avatars, product chrome |
| Favicon | `nibleaf-favicon.svg` | Browser favicon source |
| App icon | `nibleaf-app-icon.svg` | Large icon source for platform exports |
| Reverse icon | `nibleaf-icon-reverse.svg` | Mark on dark/ink surfaces |
| Monochrome icon | `nibleaf-icon-monochrome.svg` | One-color fallback |
| Current-color icon | `nibleaf-icon-currentcolor.svg` | Inline UI usage controlled by CSS color |
| Latin wordmark | `nibleaf-wordmark.svg` | Latin `Nibleaf` wordmark |
| Reverse Latin wordmark | `nibleaf-wordmark-reverse.svg` | Latin wordmark on dark/ink backgrounds |
| Arabic wordmark | `nibleaf-wordmark-ar.svg` | Arabic `Nibleaf` wordmark |
| Reverse Arabic wordmark | `nibleaf-wordmark-ar-reverse.svg` | Arabic wordmark on dark/ink backgrounds |
| Horizontal LTR lockup | `nibleaf-logo-horizontal-ltr.svg` | English headers and sidebars |
| Horizontal LTR reverse | `nibleaf-logo-horizontal-ltr-reverse.svg` | English horizontal lockup for dark/ink surfaces |
| Horizontal RTL lockup | `nibleaf-logo-horizontal-rtl.svg` | Arabic headers and sidebars |
| Horizontal icon-right alternate | `nibleaf-logo-horizontal-icon-right.svg` | Alternate English lockup with the icon at the far right |
| Horizontal reverse | `nibleaf-logo-horizontal-reverse.svg` | Arabic horizontal lockup for dark/ink surfaces |
| Stacked logo | `nibleaf-logo-stacked.svg` | Centered logo treatment |
| Stacked transparent | `nibleaf-logo-stacked-transparent.svg` | Centered logo on existing light surfaces |
| Dark stacked logo | `nibleaf-logo-dark.svg` | Centered logo on ink background |
| Monochrome stacked logo | `nibleaf-logo-monochrome.svg` | One-color fallback |
| Arabic stacked logo | `nibleaf-logo-stacked-ar.svg` | Centered Arabic-first logo treatment |
| Sidebar lockup | `nibleaf-sidebar-lockup.svg` | Compact English dashboard/sidebar lockup |
| Arabic sidebar lockup | `nibleaf-sidebar-lockup-ar.svg` | Compact Arabic dashboard/sidebar lockup |
| Social avatar | `nibleaf-social-avatar.svg` | Profile/avatar crop |
| OG card | `nibleaf-og-card.svg` | English social preview source |
| Arabic OG card | `nibleaf-og-card-ar.svg` | Arabic social preview source |

## Validation

- SVG assets are source-controlled and deterministic.
- Raster browser/app icons are generated locally with `scripts/export-brand-raster.ps1`.
- The icon mark is geometric and text-free, so favicons and platform icons do not depend on Arabic font rendering.
- Arabic wordmarks retain live text in SVG for editability; convert to outlines in Figma/Illustrator before print production.

## Raster Export Set

| Group | Files |
| --- | --- |
| Favicon | `favicon-16.png`, `favicon-32.png`, `favicon-48.png`, `favicon-64.png` |
| App icon | `apple-touch-icon-180.png`, `mstile-150.png`, `android-chrome-192.png`, `android-chrome-512.png`, `app-icon-1024.png` |
| Core icon | `nibleaf-icon-64.png`, `nibleaf-icon-128.png`, `nibleaf-icon-256.png`, `nibleaf-icon-512.png`, `nibleaf-icon-1024.png`, `nibleaf-icon-reverse-512.png`, `nibleaf-icon-monochrome-512.png` |
| Logo PNG | `nibleaf-wordmark.png`, `nibleaf-wordmark-reverse.png`, `nibleaf-wordmark-ar.png`, `nibleaf-wordmark-ar-reverse.png`, `nibleaf-logo-stacked.png`, `nibleaf-logo-stacked-transparent.png`, `nibleaf-logo-dark.png`, `nibleaf-logo-monochrome.png`, `nibleaf-logo-stacked-ar.png`, `nibleaf-logo-horizontal-ltr.png`, `nibleaf-logo-horizontal-ltr-reverse.png`, `nibleaf-logo-horizontal-rtl.png`, `nibleaf-logo-horizontal-icon-right.png`, `nibleaf-logo-horizontal-reverse.png`, `nibleaf-sidebar-lockup.png`, `nibleaf-sidebar-lockup-ar.png` |
| JPEG | `nibleaf-og-card.jpg`, `nibleaf-og-card-ar.jpg`, `nibleaf-logo-stacked.jpg`, `nibleaf-logo-dark.jpg` |
| Social | `nibleaf-social-avatar-512.png`, `nibleaf-social-avatar-1024.png`, `nibleaf-og-card.png`, `nibleaf-og-card-ar.png` |

To regenerate raster/app icons:

```powershell
pwsh ./scripts/export-brand-raster.ps1
```
