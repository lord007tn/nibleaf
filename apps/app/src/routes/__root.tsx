import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@/components/direction-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ConfirmProvider } from '@/components/ui/confirm';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
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
  return (
    <html lang="en" suppressHydrationWarning>
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
