// @vitest-environment jsdom
import type { Locale } from '@nibleaf/i18n/locales';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser's real catalog module, with the server's namespace for server renders.
const boundary = vi.hoisted(() => ({ server: false, prepared: [] as string[] }));
vi.mock('@nibleaf/i18n/dashboard-catalog', async () => {
  const server = await import('../../../packages/i18n/src/dashboard-catalog.server');
  const client = await import('../../../packages/i18n/src/dashboard-catalog.client');
  return {
    ...client,
    dashboardMessage: (id: string, locale: Locale) => (boundary.server ? server : client).dashboardMessage(id, locale),
    prepareDashboardLocale: (locale: Locale, ...rest: []) => {
      boundary.prepared.push(locale);
      return client.prepareDashboardLocale(locale, ...rest);
    },
  };
});
// Server functions read server-only configuration when imported in a browser environment.
vi.mock('@/functions/session', () => ({ getSessionFn: vi.fn() }));
vi.mock('@/functions/site', () => ({ getGitPreviewFn: vi.fn() }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://localhost:3000' }));
vi.mock('@/services/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/auth-client')>()),
  useSession: () => ({ data: null, isPending: true }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
// The product routes themselves, mounted as the generated tree mounts them, so
// the router decides what each URL matches.
vi.mock('@/routeTree.gen', async () => {
  const { createRootRoute, createRoute } = await import('@tanstack/react-router');
  const root = createRootRoute();
  const product = [
    ['/app', (await import('@/routes/app/route')).Route],
    ['/git-preview/$token', (await import('@/routes/git-preview.$token')).Route],
    ['/welcome/name', (await import('@/routes/welcome.name')).Route],
    ['/oauth/consent', (await import('@/routes/oauth.consent')).Route],
    ['/oauth/project', (await import('@/routes/oauth.project')).Route],
    ['/accept-invite/$invitationId', (await import('@/routes/accept-invite.$invitationId')).Route],
    ['/join/$token', (await import('@/routes/join.$token')).Route],
  ] as const;
  const mounted = product.map(([path, route]) =>
    (route as unknown as { update: (options: unknown) => never }).update({ id: path, path, getParentRoute: () => root }),
  );
  const other = ['/', '/$page', '/ar/$page', '/sign-in', '/sites/$projectId/$'].map((path) => createRoute({ getParentRoute: () => root, path }));
  return { routeTree: root.addChildren([...mounted, ...other]) };
});

import { setLanguage } from '@nibleaf/i18n/locale-state';
import { JoinLinkView } from '@/features/people/components/admission';
import { dashboardMessage } from '../../../packages/i18n/src/dashboard-catalog.client';
import { getRouter } from './router';

const startHydration = (path: string) => {
  window.history.replaceState(null, '', path);
  return getRouter().options.hydrate?.(undefined as never);
};

beforeEach(() => {
  boundary.prepared.length = 0;
  boundary.server = false;
  document.documentElement.setAttribute('data-locale', 'ar');
});
afterEach(() => {
  document.documentElement.removeAttribute('data-locale');
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('the real join route at /JOIN/fixture', () => {
  it('hydrates the Arabic server HTML in Arabic', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // First in this file: nothing has loaded the Arabic catalog yet.
    expect(dashboardMessage('common_cancel', 'ar')?.()).toBe('Cancel');
    const page = (
      <QueryClientProvider client={new QueryClient()}>
        <JoinLinkView token="fixture" />
      </QueryClientProvider>
    );
    boundary.server = true;
    const container = document.createElement('div');
    container.innerHTML = renderToString(page);
    boundary.server = false;
    document.body.append(container);
    const serverText = container.textContent;
    expect(serverText).toMatch(/[؀-ۿ]/);

    await startHydration('/JOIN/fixture');
    const firstClientRender = document.createElement('div');
    firstClientRender.innerHTML = renderToString(page);
    expect(firstClientRender.textContent).toBe(serverText);

    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, page, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toBe(serverText);
    await act(async () => root.unmount());
  });
});

describe('every URL the router sends to a product route', () => {
  it.each([
    '/JOIN/fixture',
    '/Join/Fixture',
    '/join/fixture/',
    '/%6Aoin/fixture',
    '/APP',
    '/App/',
    '/app/',
    '/APP/o/fixture/websites',
    '/OAUTH/CONSENT',
    '/oauth/project/',
    '/WELCOME/NAME',
    '/welcome/name/',
    '/GIT-PREVIEW/fixture',
    '/Accept-Invite/fixture/',
  ])('prepares the server language before hydrating %s', async (path) => {
    await startHydration(path);
    expect(boundary.prepared).toEqual(['ar']);
  });

  it.each(['/', '/AR/pricing', '/sign-in', '/SIGN-IN', '/sites/fixture/page', '/application', '/joined/fixture', '/welcome'])(
    'starts %s without a catalog',
    (path) => {
      expect(startHydration(path)).toBeUndefined();
      expect(boundary.prepared).toEqual([]);
    },
  );

  it('prepares a language chosen on a mixed-case dashboard URL', async () => {
    document.documentElement.setAttribute('data-locale', 'en');
    window.history.replaceState(null, '', '/APP/o/fixture/websites');
    getRouter();
    await import('@/lib/dashboard-locale');
    try {
      await setLanguage('de');
      expect(dashboardMessage('common_cancel', 'de')?.()).toBe('Abbrechen');
    } finally {
      await setLanguage('ar');
    }
  });
});
