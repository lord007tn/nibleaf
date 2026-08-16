import { THEME_NOFLASH_SCRIPT, ThemeProvider } from '@nibleaf/design-system/theme';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouter, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { SiteShell } from '@/hooks/api/types';
import appCss from '@/styles.css?url';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
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
  const nonce = useRouter().options.ssr?.nonce;
  // Reflect a published site's active language on <html lang/dir> during SSR (so
  // crawlers + the first paint see e.g. lang="ar" dir="rtl"), updating reactively
  // on ?lang switches. Non-site routes keep the en/ltr default — the dashboard's
  // own DirectionProvider governs its direction.
  const { lang, dir, siteProjectId } = useRouterState({
    select: (state) => {
      const match = state.matches.find((m) => m.routeId === '/sites/$projectId');
      const site = (match?.loaderData as { site?: SiteShell } | undefined)?.site;
      if (!site) {
        const articleMatch = state.matches.find((m) => m.routeId === '/blog/$slug');
        const language = (articleMatch?.loaderData as { language?: 'ar' | 'en' } | undefined)?.language ?? 'en';
        if (language === 'ar') {
          return { lang: 'ar', dir: 'rtl' as const, siteProjectId: undefined };
        }
        return { lang: 'en', dir: 'ltr' as const, siteProjectId: undefined };
      }
      const code = (state.location.search as { lang?: string }).lang ?? site.activeLanguage;
      const active = site.languages.find((l) => l.code === code) ?? site.languages.find((l) => l.isDefault) ?? site.languages[0];
      return {
        lang: active?.code ?? 'en',
        dir: active?.direction === 'RTL' ? ('rtl' as const) : ('ltr' as const),
        siteProjectId: (match?.params as { projectId?: string } | undefined)?.projectId,
      };
    },
  });
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        {/* Set the theme class before paint to avoid a flash of the wrong theme. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, static inline theme bootstrap. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_NOFLASH_SCRIPT }} nonce={nonce} />
        {nonce ? <meta property="csp-nonce" content={nonce} /> : null}
        {siteProjectId ? <meta name="nibleaf-site-project" content={siteProjectId} /> : null}
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
