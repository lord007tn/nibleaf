import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { THEME_NOFLASH_SCRIPT, ThemeProvider } from '@nibleaf/design-system/theme';
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
      { title: 'Nibleaf Admin' },
      // Internal panel — never index.
      { name: 'robots', content: 'noindex, nofollow' },
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
        {/* Set the theme class before paint to avoid a flash of the wrong theme. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, static inline theme bootstrap. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_NOFLASH_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ThemeProvider>
        <Toaster position="bottom-right" richColors />
        <Scripts />
      </body>
    </html>
  );
}
