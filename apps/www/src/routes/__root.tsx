import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { LocaleProvider } from '@/lib/i18n';
import { WWW_URL } from '@/lib/links';
import appCss from '@/styles.css?url';

const TITLE = 'Midad — open-source documentation publishing';
const DESCRIPTION =
  'Fast, searchable documentation you can self-host today. Cloud-hosted Midad is coming soon, with Arabic-ready authoring built in.';
const OG_IMAGE = `${WWW_URL}/og.svg`;

// Organization + SoftwareApplication structured data for rich results.
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Midad',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  description: DESCRIPTION,
  url: WWW_URL,
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'author', content: 'Takumi' },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Midad' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: WWW_URL },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'article:author', content: 'Takumi' },
      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE },
      { name: 'twitter:creator', content: 'Takumi' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
      { rel: 'canonical', href: WWW_URL },
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
