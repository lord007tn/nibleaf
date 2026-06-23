import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { WWW_URL } from '@/lib/links';
import appCss from '@/styles.css?url';

const TITLE = 'Plume — the open-source documentation platform';
const DESCRIPTION = 'Beautiful, fast, searchable docs you can self-host. The open-source alternative to Mintlify.';
const OG_IMAGE = `${WWW_URL}/og.svg`;

// Organization + SoftwareApplication structured data for rich results.
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Plume',
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
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Plume' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: WWW_URL },
      { property: 'og:image', content: OG_IMAGE },
      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
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
        <ThemeProvider>{children}</ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
