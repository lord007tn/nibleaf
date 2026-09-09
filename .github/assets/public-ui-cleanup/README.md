# Public UI cleanup captures

Local Chromium captures of the actual English and Arabic landing components and public SitePageView at 1440x1000 and 390x1000. Homepage captures show the self-hosting guide retained without the inline installer. Reader captures show normal article content without View/Copy Markdown controls. All four mobile documents measured 390px wide without horizontal overflow; Arabic is RTL.

The isolated harness uses repository styles (including reader typography), synthetic article content, a fixed public repository link, and inert analytics/page-alternate hooks. It connects to no product backend or account. These are local component/layout checks, not deployed-production evidence. The only browser console error was the harness's missing favicon. No motion recording is needed for removed controls.
