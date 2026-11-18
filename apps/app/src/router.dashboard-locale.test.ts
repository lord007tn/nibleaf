// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({ customDomain: null as string | null, hydrate: vi.fn<() => Promise<void>>() }));
vi.mock('@/lib/dashboard-locale', () => ({ hydrateDashboardLocale: boot.hydrate }));
vi.mock('@/lib/custom-domain-rewrite', () => ({
  hydratedCustomDomainProjectId: () => boot.customDomain,
  rewriteCustomDomainInput: vi.fn(),
  rewriteCustomDomainOutput: vi.fn(),
}));
vi.mock('@/routeTree.gen', async () => {
  const { createRootRoute } = await import('@tanstack/react-router');
  return { routeTree: createRootRoute() };
});

import { getRouter } from './router';

const startHydration = (path: string) => {
  window.history.replaceState(null, '', path);
  return getRouter().options.hydrate?.(undefined as never);
};

beforeEach(() => {
  boot.customDomain = null;
  boot.hydrate.mockReset();
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('hydration waits for the interface catalog', () => {
  it.each([
    '/app/o/fixture/websites',
    '/git-preview/fixture',
    '/welcome/name',
    '/oauth/consent',
    '/oauth/project',
    '/accept-invite/fixture',
    '/join/fixture',
  ])('holds %s until the catalog is ready', async (path) => {
    let ready!: () => void;
    boot.hydrate.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    let hydrated = false;
    const pending = Promise.resolve(startHydration(path)).then(() => {
      hydrated = true;
    });
    await vi.waitFor(() => expect(boot.hydrate).toHaveBeenCalledOnce());
    expect(hydrated).toBe(false);
    ready();
    await pending;
    expect(hydrated).toBe(true);
  });

  it.each(['/', '/ar', '/blog/fixture', '/sign-in', '/sites/fixture'])('starts %s without loading a catalog', (path) => {
    expect(startHydration(path)).toBeUndefined();
    expect(boot.hydrate).not.toHaveBeenCalled();
  });

  it('never treats a page of a published custom domain as the dashboard', () => {
    boot.customDomain = 'fixture-project';
    expect(startHydration('/app/getting-started')).toBeUndefined();
    expect(boot.hydrate).not.toHaveBeenCalled();
  });
});
