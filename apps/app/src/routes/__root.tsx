import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@/components/direction-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ConfirmProvider } from '@/components/ui/confirm';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SiteShell } from '@/hooks/api/types';
import { LocaleProvider } from '@/lib/i18n';
import appCss from '@/styles.css?url';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Plume — open-source documentation platform' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
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
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <DirectionProvider>
            <LocaleProvider>
              <ConfirmProvider>
                <TooltipProvider>{children}</TooltipProvider>
                <Toaster position="bottom-right" richColors />
              </ConfirmProvider>
            </LocaleProvider>
          </DirectionProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
