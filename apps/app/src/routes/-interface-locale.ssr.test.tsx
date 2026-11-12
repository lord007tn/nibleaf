// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { Locale } from '@nibleaf/i18n/locales';
import { useT } from '@nibleaf/i18n/react';
import { withInterfaceLocale } from '@nibleaf/i18n/request-locale';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LocalizedProductProviders } from '@/components/localized-product-providers';
import type { SiteShell } from '@/hooks/api/types';

vi.mock('@/components/root-marketing-analytics', () => ({ RootMarketingAnalytics: () => null }));

import { Route as RootRoute } from './__root';

// The real root document (<html lang dir>) over three stand-in pages: a product
// page (staticData.interfaceLocale, like the auth, dashboard and invitation
// routes), an English marketing page, and a published reader whose site is
// English. The server renders them the way src/server.ts does for a request.
function ProductPage() {
  const t = useT();
  return <button type="button">{t('auth.otp.sendSignIn')}</button>;
}

const englishSite = {
  project: { id: 'docs', name: 'Docs', slug: 'docs', description: null, config: null, primaryDomain: null },
  nav: [],
  languages: [
    { code: 'en', label: 'English', direction: 'LTR', isDefault: true },
    { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false },
  ],
  versions: [],
  activeLanguage: 'en',
  activeVersion: 'main',
  languageConfig: null,
  version: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
} as unknown as SiteShell;

const productRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/sign-in',
  staticData: { interfaceLocale: true },
  component: () => (
    <LocalizedProductProviders>
      <ProductPage />
    </LocalizedProductProviders>
  ),
});
const marketingRoute = createRoute({ getParentRoute: () => RootRoute, path: '/pricing', component: () => <main>Pricing</main> });
const readerRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/sites/$projectId',
  loader: () => ({ site: englishSite }),
  component: () => <main>Reader</main>,
});

async function serverRender(path: string, locale: Locale) {
  const render = async () => {
    const router = createRouter({
      routeTree: RootRoute.addChildren([productRoute, marketingRoute, readerRoute]),
      history: createMemoryHistory({ initialEntries: [path] }),
      context: { queryClient: new QueryClient() },
      isServer: true,
    });
    await router.load();
    return renderToString(<RouterProvider router={router} />);
  };
  // Like src/server.ts: marketing documents and published readers render
  // outside the request's interface locale; every other request inside it.
  const outsideLocale = path === '/pricing' || path.startsWith('/sites/');
  return outsideLocale ? render() : withInterfaceLocale(locale, 'https://app.nibleaf.test', render);
}

const htmlTag = (html: string) => /<html[^>]*>/.exec(html)?.[0] ?? '';

describe('server-rendered interface language', () => {
  it('renders an Arabic visitor’s product page in Arabic and right to left', async () => {
    const html = await serverRender('/sign-in', 'ar');
    expect(htmlTag(html)).toContain('lang="ar"');
    expect(htmlTag(html)).toContain('dir="rtl"');
    expect(htmlTag(html)).toContain('data-locale="ar"');
    expect(html).toContain('تسجيل الدخول');
    expect(html).not.toContain('Log in');
  });

  it('keeps an English visitor’s product page in English and left to right', async () => {
    const html = await serverRender('/sign-in', 'en');
    expect(htmlTag(html)).toContain('lang="en"');
    expect(htmlTag(html)).toContain('dir="ltr"');
    expect(htmlTag(html)).toContain('data-locale="en"');
    expect(html).toContain('Log in');
  });

  it('keeps an English marketing page English for an Arabic visitor', async () => {
    const html = await serverRender('/pricing', 'ar');
    expect(htmlTag(html)).toContain('lang="en"');
    expect(htmlTag(html)).toContain('dir="ltr"');
    expect(htmlTag(html)).not.toContain('data-locale');
  });

  it('takes a published reader’s lang and dir from the page, not the visitor', async () => {
    const html = await serverRender('/sites/docs', 'ar');
    expect(htmlTag(html)).toContain('lang="en"');
    expect(htmlTag(html)).toContain('dir="ltr"');
    expect(htmlTag(html)).not.toContain('data-locale');
  });
});

describe('product routes', () => {
  // Every route that renders the product providers in the interface language
  // must say so, or its <html lang dir> stays English while the page is Arabic.
  it.each([
    '(auth)/route.tsx',
    'accept-invite.$invitationId.tsx',
    'app/route.tsx',
    'join.$token.tsx',
    'oauth.consent.tsx',
    'oauth.project.tsx',
    'welcome.name.tsx',
  ])('%s declares staticData.interfaceLocale', (file) => {
    expect(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).toMatch(/staticData: \{ interfaceLocale: true \}/);
  });
});
