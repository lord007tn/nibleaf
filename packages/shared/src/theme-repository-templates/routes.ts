/** `src/router.tsx` and `src/routes/*`: TanStack Start file routes. `/` renders
 * the first page of the default language, `$` serves every content path and
 * the 404 state; `<html lang dir>` follows the language in the URL. */
export const routerTemplate = (): string => `import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
`;

export const rootRouteTemplate =
  (): string => `import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router';
import { htmlAttributes, site } from '../lib/site';
import appCss from '../styles.css?url';

// Applies the saved (or configured) color scheme before the first paint so a
// dark-mode reader never sees a light flash. Mirrors ThemeToggle's storage key.
const themeBootstrap =
  "(function(){try{var s=localStorage.getItem('nibleaf-docs-theme');var c=" +
  JSON.stringify(site.appearance) +
  ";var d=s==='dark'||(s!=='light'&&(c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)));" +
  "var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(_){}})();";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: site.name },
      ...(site.description ? [{ name: 'description', content: site.description }] : []),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dir, lang } = htmlAttributes(pathname);
  return (
    <html dir={dir} lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen bg-canvas text-foreground antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
`;

export const indexRouteTemplate = (): string => `import { createFileRoute } from '@tanstack/react-router';
import { DocsPage, NotFoundPage } from '../components/docs-page';
import { firstPage, site } from '../lib/site';

const landing = firstPage(site.defaultLanguage, site.defaultVersion);

/** The root URL shows the first page of the default language, so static hosts
 * need no redirect rule and the prerender crawl starts from real content. */
export const Route = createFileRoute('/')({
  head: () => ({
    meta: landing
      ? [{ title: landing.title + ' · ' + site.name }, ...(landing.description ? [{ name: 'description', content: landing.description }] : [])]
      : [],
    links: landing && landing.route !== '/' ? [{ rel: 'canonical', href: landing.route }] : [],
  }),
  component: Index,
});

function Index() {
  return landing ? <DocsPage page={landing} /> : <NotFoundPage pathname="/" />;
}
`;

export const splatRouteTemplate = (): string => `import { createFileRoute, notFound, useLocation } from '@tanstack/react-router';
import { DocsPage, NotFoundPage } from '../components/docs-page';
import { pageForRoute, pages, site } from '../lib/site';

export const Route = createFileRoute('/$')({
  loader: ({ params }) => {
    const page = pageForRoute('/' + (params._splat ?? ''));
    if (!page) throw notFound();
    return { file: page.file, title: page.title, description: page.description ?? null };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: loaderData.title + ' · ' + site.name }, ...(loaderData.description ? [{ name: 'description', content: loaderData.description }] : [])]
      : [],
  }),
  component: ContentPage,
  notFoundComponent: ContentNotFound,
});

function ContentPage() {
  const { file } = Route.useLoaderData();
  const page = pages.find((item) => item.file === file);
  return page ? <DocsPage page={page} /> : <ContentNotFound />;
}

function ContentNotFound() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return <NotFoundPage pathname={pathname} />;
}
`;
