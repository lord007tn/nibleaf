import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { ThemeProvider } from '@nibleaf/design-system/theme';
import { isRtl, translateFn } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import appCss from '@/styles.css?url';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: translateFn('admin.meta.title') },
      { name: 'application-name', content: translateFn('admin.meta.title') },
      { name: 'theme-color', content: '#181612' },
      // Internal panel — never index.
      { name: 'robots', content: 'noindex, nofollow' },
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
  const { locale } = useLocale();
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
