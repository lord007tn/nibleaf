import { ThemeProvider } from '@nibleaf/design-system/theme';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { RootMarketingAnalytics } from '@/components/root-marketing-analytics';
import { useRootDocument } from '@/lib/root-document';
import { siteThemeNoFlashScript } from '@/lib/site-theme';
import appCss from '@/styles.css?url';

/** Available to every route's `beforeLoad` / `loader` as `context`. */
export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: ({ matches }) => {
    const document = [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }];
    // A published docs site carries its own name, icon and theme color (see
    // siteHead): Nibleaf's branding stays on the product and marketing pages.
    if (matches.some((match) => (match.routeId as string) === '/sites/$projectId')) {
      return { meta: document, links: [{ rel: 'stylesheet', href: appCss }] };
    }
    return {
      meta: [
        ...document,
        { title: 'Nibleaf Cloud — documentation workspace' },
        { name: 'application-name', content: 'Nibleaf' },
        { name: 'theme-color', content: '#181612' },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'icon', href: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    };
  },
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
  const nonce = useRouter().options.ssr?.nonce;
  const { lang, dir, pathname, siteProjectId, siteThemeDefault } = useRootDocument();
  const siteThemeBootstrap = siteProjectId ? siteThemeNoFlashScript(siteProjectId, siteThemeDefault ?? 'light') : null;
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        {nonce ? <meta property="csp-nonce" content={nonce} /> : null}
        {siteProjectId ? <meta name="nibleaf-site-project" content={siteProjectId} /> : null}
        <HeadContent />
      </head>
      <body>
        <ThemeProvider applyDocumentTheme={!siteProjectId} initialThemeScript={siteThemeBootstrap ?? undefined}>
          {children}
        </ThemeProvider>
        <RootMarketingAnalytics pathname={pathname} siteProjectId={siteProjectId} language={lang === 'ar' ? 'ar' : 'en'} />
        <Scripts />
      </body>
    </html>
  );
}
