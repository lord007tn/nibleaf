import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@/components/direction-provider';
import { ConfirmProvider as DesignConfirmProvider } from '@midad/design-system/components/ui/confirm';
import { Toaster } from '@midad/design-system/components/ui/sonner';
import { TooltipProvider } from '@midad/design-system/components/ui/tooltip';
import { THEME_NOFLASH_SCRIPT, ThemeProvider } from '@midad/design-system/theme';
import type { SiteShell } from '@/hooks/api/types';
import { LocaleProvider, useT } from '@/lib/i18n';
import appCss from '@/styles.css?url';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Midad — open-source documentation platform' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
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
  // Reflect a published site's active language on <html lang/dir> during SSR (so
  // crawlers + the first paint see e.g. lang="ar" dir="rtl"), updating reactively
  // on ?lang switches. Non-site routes keep the en/ltr default — the dashboard's
  // own DirectionProvider governs its direction.
  const { lang, dir } = useRouterState({
    select: (state) => {
      const match = state.matches.find((m) => m.routeId === '/sites/$projectId');
      const site = (match?.loaderData as { site?: SiteShell } | undefined)?.site;
      if (!site) {
        return { lang: 'en', dir: 'ltr' as const };
      }
      const code = (state.location.search as { lang?: string }).lang ?? site.activeLanguage;
      const active = site.languages.find((l) => l.code === code) ?? site.languages.find((l) => l.isDefault) ?? site.languages[0];
      return { lang: active?.code ?? 'en', dir: active?.direction === 'RTL' ? ('rtl' as const) : ('ltr' as const) };
    },
  });
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        {/* Set the theme class before paint to avoid a flash of the wrong theme. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, static inline theme bootstrap. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_NOFLASH_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <DirectionProvider>
            <LocaleProvider>
              <AppConfirmProvider>
                <TooltipProvider>{children}</TooltipProvider>
                <Toaster position="bottom-right" richColors />
              </AppConfirmProvider>
            </LocaleProvider>
          </DirectionProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

function AppConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  return <DesignConfirmProvider labels={{ cancel: t('common.cancel'), delete: t('common.delete'), save: t('common.save') }}>{children}</DesignConfirmProvider>;
}


