// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routesFor: Record<string, string[]> = {
  '/app/sites': ['__root__', '/app', '/app/(dashboard)', '/app/(dashboard)/sites'],
  '/app/projects/p1/analytics': [
    '__root__',
    '/app',
    '/app/projects/$projectId',
    '/app/projects/$projectId/analytics',
    '/app/projects/$projectId/analytics/',
  ],
};
const getMatchedRoutes = vi.fn((pathname: string) => [(routesFor[pathname] ?? ['__root__']).map((id) => ({ id })), {}, undefined]);
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ getMatchedRoutes }) }));

const manifest = {
  '/app': ['/assets/route-a.js'],
  '/app/(dashboard)/sites': ['/assets/sites-a.js', '/assets/table-a.js'],
  '/app/projects/$projectId/analytics': ['/assets/analytics-a.js', '/assets/chart-a.js'],
  '/app/projects/$projectId/analytics/': ['/assets/analytics.index-a.js', '/assets/chart-a.js'],
};

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const fetchManifest = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(manifest), { status: 200 }));
let unmount: (() => Promise<void>) | null = null;

/** A fresh copy of the module (its manifest and dedupe state) mounted in a component. */
async function mount() {
  vi.resetModules();
  const [{ act }, { createRoot }, { useDashboardIntentPreload }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('./dashboard-intent-preload'),
  ]);
  function Shell() {
    useDashboardIntentPreload();
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Shell />));
  unmount = async () => act(async () => root.unmount());
}

/** Lets the idle callback (a timeout in jsdom) and the manifest fetch finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function link(href: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  const label = document.createElement('span');
  label.textContent = href;
  anchor.append(label);
  document.body.append(anchor);
  return label;
}

const hover = (target: Element) => target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
const preloaded = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map((item) => item.getAttribute('href'));

beforeEach(() => {
  vi.stubEnv('PROD', true);
  vi.stubGlobal('fetch', fetchManifest);
  fetchManifest.mockClear();
  getMatchedRoutes.mockClear();
});

afterEach(async () => {
  await unmount?.();
  unmount = null;
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

describe('useDashboardIntentPreload', () => {
  it('preloads the chunks of every route a hovered dashboard link matches, once', async () => {
    await mount();
    await settle();
    // Always revalidated, never a per-build query (that would rename reader chunks every build).
    expect(fetchManifest).toHaveBeenCalledWith('/dashboard-preloads.json', { cache: 'no-cache' });

    const sites = link('/app/sites');
    hover(sites);
    expect(preloaded()).toEqual(['/assets/route-a.js', '/assets/sites-a.js', '/assets/table-a.js']);
    expect(getMatchedRoutes).toHaveBeenCalledWith('/app/sites');

    hover(sites);
    link('/app/sites').parentElement?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(preloaded()).toHaveLength(3);

    link('/app/projects/p1/analytics').parentElement?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(preloaded()).toEqual([
      '/assets/route-a.js',
      '/assets/sites-a.js',
      '/assets/table-a.js',
      '/assets/analytics-a.js',
      '/assets/chart-a.js',
      '/assets/analytics.index-a.js',
    ]);
  });

  it('ignores links outside /app and on other origins', async () => {
    await mount();
    await settle();
    hover(link('/sites/p1/getting-started'));
    hover(link('/apple'));
    hover(link('https://example.com/app/sites'));
    expect(preloaded()).toEqual([]);
    expect(getMatchedRoutes).not.toHaveBeenCalled();
  });

  it('does nothing before the manifest loads', async () => {
    const respond: Array<(response: Response) => void> = [];
    fetchManifest.mockImplementationOnce(() => new Promise<Response>((resolve) => void respond.push(resolve)));
    await mount();
    await settle();
    hover(link('/app/sites'));
    expect(preloaded()).toEqual([]);

    for (const resolve of respond) resolve(new Response(JSON.stringify(manifest), { status: 200 }));
    await settle();
    // The same link works once the manifest is there.
    hover(document.querySelector('a span') as Element);
    expect(preloaded()).toHaveLength(3);
  });

  it('stays quiet when the manifest is missing or malformed', async () => {
    fetchManifest.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await mount();
    await settle();
    hover(link('/app/sites'));
    expect(preloaded()).toEqual([]);
  });

  it('does nothing in development', async () => {
    vi.stubEnv('PROD', false);
    await mount();
    await settle();
    hover(link('/app/sites'));
    expect(fetchManifest).not.toHaveBeenCalled();
    expect(preloaded()).toEqual([]);
  });

  it('removes its listeners on unmount', async () => {
    await mount();
    await settle();
    await unmount?.();
    unmount = null;
    hover(link('/app/sites'));
    expect(preloaded()).toEqual([]);
  });
});
