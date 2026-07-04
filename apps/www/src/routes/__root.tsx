import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { LocaleProvider } from '@/lib/i18n';
import { WWW_URL } from '@/lib/links';
import appCss from '@/styles.css?url';

const TITLE = 'Midad — open-source documentation publishing';
const DESCRIPTION =
  'Fast, searchable documentation you can self-host today. Cloud-hosted Midad is coming soon, with Arabic-ready authoring built in.';
const OG_IMAGE = `${WWW_URL}/brand/raster/social/midad-og-card.png`;
const OG_IMAGE_ALT = 'Midad — open-source documentation platform';

// Organization + SoftwareApplication structured data for rich results.
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Midad',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  description: DESCRIPTION,
  url: WWW_URL,
  image: OG_IMAGE,
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'author', content: 'Midad' },
      { name: 'application-name', content: 'Midad' },
      { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' },
      // A single brand-umber chrome colour (TanStack dedupes meta by `name`, so
      // media-scoped light/dark variants would collapse to one anyway).
      { name: 'theme-color', content: '#8a4b2e' },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Midad' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: WWW_URL },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: OG_IMAGE_ALT },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:locale:alternate', content: 'ar_AR' },
      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE },
      { name: 'twitter:image:alt', content: OG_IMAGE_ALT },
    ],
    links: [
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
    <html lang="en" suppressHydrationWarning>
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
