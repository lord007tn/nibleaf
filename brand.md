# Midad Brand Assets

Midad / `مِداد` is the production brand for this project. The identity is built around ink, ivory paper, composed technical publishing, and warm umber/copper accents that work in both Arabic and English UI without a cold cast.

## Core Palette

| Token | Hex | Use |
| --- | --- | --- |
| Paper | `#FBF7EE` | Warm marketing/background surface |
| Paper 2 | `#EEE4D3` | Secondary surface and quiet bands |
| Ink | `#181612` | Primary text, dark surfaces, monochrome mark |
| Ink 2 | `#4E453A` | Softer text |
| Border | `#DED2C0` | Lines and quiet dividers |
| Midad Umber | `#8A4B2E` | Primary brand mark and calls to action |
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
| Core icon | `midad-icon.svg` | Compact UI mark, avatars, product chrome |
| Favicon | `midad-favicon.svg` | Browser favicon source |
| App icon | `midad-app-icon.svg` | Large icon source for platform exports |
| Reverse icon | `midad-icon-reverse.svg` | Mark on dark/ink surfaces |
| Monochrome icon | `midad-icon-monochrome.svg` | One-color fallback |
| Current-color icon | `midad-icon-currentcolor.svg` | Inline UI usage controlled by CSS color |
| Latin wordmark | `midad-wordmark.svg` | Latin `Midad` wordmark |
| Reverse Latin wordmark | `midad-wordmark-reverse.svg` | Latin wordmark on dark/ink backgrounds |
| Arabic wordmark | `midad-wordmark-ar.svg` | Arabic `مِداد` wordmark |
| Reverse Arabic wordmark | `midad-wordmark-ar-reverse.svg` | Arabic wordmark on dark/ink backgrounds |
| Horizontal LTR lockup | `midad-logo-horizontal-ltr.svg` | English headers and sidebars |
| Horizontal LTR reverse | `midad-logo-horizontal-ltr-reverse.svg` | English horizontal lockup for dark/ink surfaces |
| Horizontal RTL lockup | `midad-logo-horizontal-rtl.svg` | Arabic headers and sidebars |
| Horizontal icon-right alternate | `midad-logo-horizontal-icon-right.svg` | Alternate English lockup with the icon at the far right |
| Horizontal reverse | `midad-logo-horizontal-reverse.svg` | Arabic horizontal lockup for dark/ink surfaces |
| Stacked logo | `midad-logo-stacked.svg` | Centered logo treatment |
| Stacked transparent | `midad-logo-stacked-transparent.svg` | Centered logo on existing light surfaces |
| Dark stacked logo | `midad-logo-dark.svg` | Centered logo on ink background |
| Monochrome stacked logo | `midad-logo-monochrome.svg` | One-color fallback |
| Arabic stacked logo | `midad-logo-stacked-ar.svg` | Centered Arabic-first logo treatment |
| Sidebar lockup | `midad-sidebar-lockup.svg` | Compact English dashboard/sidebar lockup |
| Arabic sidebar lockup | `midad-sidebar-lockup-ar.svg` | Compact Arabic dashboard/sidebar lockup |
| Social avatar | `midad-social-avatar.svg` | Profile/avatar crop |
| OG card | `midad-og-card.svg` | English social preview source |
| Arabic OG card | `midad-og-card-ar.svg` | Arabic social preview source |

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
| Core icon | `midad-icon-64.png`, `midad-icon-128.png`, `midad-icon-256.png`, `midad-icon-512.png`, `midad-icon-1024.png`, `midad-icon-reverse-512.png`, `midad-icon-monochrome-512.png` |
| Logo PNG | `midad-wordmark.png`, `midad-wordmark-reverse.png`, `midad-wordmark-ar.png`, `midad-wordmark-ar-reverse.png`, `midad-logo-stacked.png`, `midad-logo-stacked-transparent.png`, `midad-logo-dark.png`, `midad-logo-monochrome.png`, `midad-logo-stacked-ar.png`, `midad-logo-horizontal-ltr.png`, `midad-logo-horizontal-ltr-reverse.png`, `midad-logo-horizontal-rtl.png`, `midad-logo-horizontal-icon-right.png`, `midad-logo-horizontal-reverse.png`, `midad-sidebar-lockup.png`, `midad-sidebar-lockup-ar.png` |
| JPEG | `midad-og-card.jpg`, `midad-og-card-ar.jpg`, `midad-logo-stacked.jpg`, `midad-logo-dark.jpg` |
| Social | `midad-social-avatar-512.png`, `midad-social-avatar-1024.png`, `midad-og-card.png`, `midad-og-card-ar.png` |

To regenerate raster/app icons:

```powershell
pwsh ./scripts/export-brand-raster.ps1
```
