import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { LocaleProvider } from '@/lib/i18n';
import { APP_URL, GITHUB_URL, WWW_URL } from '@/lib/links';
import appCss from '@/styles.css?url';

const TITLE = 'Nibleaf — cloud documentation hosting with an open-source core';
const DESCRIPTION =
  'Nibleaf Cloud is the managed documentation platform for teams shipping polished docs. Write in Markdown, publish searchable sites, connect custom domains, track analytics, and keep an open-source core in reach.';
const OG_IMAGE = `${WWW_URL}/brand/raster/social/nibleaf-og-card.png`;
const OG_IMAGE_ALT = 'Nibleaf Cloud — managed documentation hosting';

// Organization + WebSite + SoftwareApplication structured data for rich results.
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${WWW_URL}/#organization`,
      name: 'Nibleaf',
      url: WWW_URL,
      logo: { '@type': 'ImageObject', url: `${WWW_URL}/brand/raster/logo/nibleaf-logo-horizontal-ltr.png` },
      sameAs: [GITHUB_URL],
    },
    {
      '@type': 'WebSite',
      '@id': `${WWW_URL}/#website`,
      name: 'Nibleaf',
      url: WWW_URL,
      inLanguage: ['en', 'ar'],
      publisher: { '@id': `${WWW_URL}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${WWW_URL}/#software`,
      name: 'Nibleaf',
      applicationCategory: 'DeveloperApplication',
      applicationSubCategory: 'Documentation Platform',
      operatingSystem: 'Web',
      description: DESCRIPTION,
      url: WWW_URL,
      image: OG_IMAGE,
      inLanguage: ['en', 'ar'],
      license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      downloadUrl: GITHUB_URL,
      softwareVersion: '0.1.0',
      isAccessibleForFree: true,
      publisher: { '@id': `${WWW_URL}/#organization` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: `${APP_URL}/sign-up` },
    },
  ],
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'author', content: 'Nibleaf' },
      { name: 'application-name', content: 'Nibleaf' },
      { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' },
      // A single brand-terracotta chrome colour (TanStack dedupes meta by `name`,
      // so media-scoped light/dark variants would collapse to one anyway).
      { name: 'theme-color', content: '#C2410C' },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Nibleaf' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: WWW_URL },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: OG_IMAGE_ALT },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:locale:alternate', content: 'ar_SA' },
      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE },
      { name: 'twitter:image:alt', content: OG_IMAGE_ALT },
    ],
    links: [
      { rel: 'preconnect', href: APP_URL, crossOrigin: 'anonymous' },
      { rel: 'dns-prefetch', href: APP_URL },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
    scripts: [{ type: 'application/ld+json', children: JSON_LD }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <LocaleProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </LocaleProvider>
        <Scripts />
      </body>
    </html>
  );
}
