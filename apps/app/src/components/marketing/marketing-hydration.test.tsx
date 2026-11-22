// @vitest-environment jsdom

import { PassThrough } from 'node:stream';
import { act, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server.node';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * #650: a marketing page (`/pricing`, `/guides`) lost its server HTML while it
 * hydrated, most visibly with a dark preference. The page component loads
 * lazily on a first visit, inside `<Suspense fallback={null}>`, so it hydrates
 * only once its chunk arrives. The root ThemeProvider settled its stored and
 * resolved theme in a mount effect at default priority, which updated the theme
 * context above that still-suspended boundary. React can't hydrate a boundary
 * that changed under it, so it dropped the server HTML for the empty fallback
 * until the chunk loaded: seconds of blank page on the dev server.
 */

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  // The pre-hydration theme script needs a router; this test has none.
  ScriptOnce: () => null,
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let releasePage: (() => void) | undefined;

afterEach(async () => {
  releasePage?.();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  releasePage = undefined;
  vi.doUnmock('./pages/pricing');
  vi.doUnmock('./pages/guides');
  vi.resetModules();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.style.colorScheme = '';
});

const renderCompleteHtml = (node: ReactNode): Promise<string> =>
  new Promise((resolve, reject) => {
    const output = new PassThrough();
    let html = '';
    output.on('data', (chunk) => {
      html += chunk.toString();
    });
    output.on('end', () => resolve(html));
    output.on('error', reject);
    const { pipe } = renderToPipeableStream(node, { onAllReady: () => pipe(output), onError: reject });
  });

const PAGES = {
  '/pricing': { module: './pages/pricing', heading: 'Pricing' },
  '/guides': { module: './pages/guides', heading: 'Guides' },
} as const;
type PagePath = keyof typeof PAGES;

/** Stands in for a page module: its chunk arrives once `gate` resolves. */
const mockPageModule = (path: PagePath, gate: Promise<void>) => {
  const { module, heading } = PAGES[path];
  vi.doMock(module, async () => {
    await gate;
    return {
      load: async () => ({}),
      Page: () => (
        <>
          <header>Nibleaf</header>
          <main>
            <h1>{heading}</h1>
          </main>
        </>
      ),
    };
  });
};

const stubColorScheme = (dark: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      matches: dark && media === '(prefers-color-scheme: dark)',
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
};

const importApp = async () => ({
  theme: await import('@nibleaf/design-system/theme'),
  routes: await import('./routes'),
});

const App = ({ modules, data }: { modules: Awaited<ReturnType<typeof importApp>>; data: { marketingPath: string } }) => {
  const { ThemeProvider } = modules.theme;
  const { MarketingPage } = modules.routes;
  return (
    <ThemeProvider>
      <MarketingPage data={{ marketingPath: data.marketingPath, marketingParams: {} }} />
    </ThemeProvider>
  );
};

/** Server-renders `path`, then hydrates it with a cold client module graph
 *  whose page chunk is still downloading, recording every removal of the
 *  server's `<main>`. */
async function serverRenderThenHydrate(path: PagePath, { systemDark, stored }: { systemDark: boolean; stored: string | null }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The server: its loader resolved the page module before rendering.
  mockPageModule(path, Promise.resolve());
  const serverModules = await importApp();
  await serverModules.routes.loadMarketingPage(path);
  const html = await renderCompleteHtml(<App modules={serverModules} data={{ marketingPath: path }} />);

  // The browser, with its own preference and an empty module cache.
  stubColorScheme(systemDark);
  if (stored) window.localStorage.setItem('nibleaf.theme', stored);
  container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const serverMain = container.querySelector('main');
  expect(serverMain?.textContent).toBe(PAGES[path].heading);
  const mainRemovals: Node[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const removed of record.removedNodes) {
        if (removed === serverMain || removed.contains(serverMain)) mainRemovals.push(removed);
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  vi.resetModules();
  const gate = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  mockPageModule(path, gate);
  const clientModules = await importApp();
  const recoverableErrors: unknown[] = [];
  // Hydrate while the page chunk is still on its way, and let the providers'
  // mount effects (the stored theme) run.
  await act(async () => {
    root = hydrateRoot(container as HTMLDivElement, <App modules={clientModules} data={{ marketingPath: path }} />, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const removedWhileLoading = [...mainRemovals];
  const textWhileLoading = container.textContent;
  // Then the chunk arrives and the page hydrates.
  await act(async () => {
    releasePage?.();
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  observer.disconnect();
  return { serverMain, removedWhileLoading, textWhileLoading, mainRemovals, recoverableErrors };
}

describe('marketing page hydration under every theme preference (#650)', () => {
  it.each([
    { path: '/pricing', systemDark: true, stored: null },
    { path: '/pricing', systemDark: true, stored: 'system' },
    { path: '/pricing', systemDark: true, stored: 'light' },
    { path: '/pricing', systemDark: false, stored: 'dark' },
    { path: '/pricing', systemDark: false, stored: null },
    { path: '/guides', systemDark: true, stored: null },
  ] as const)(
    'keeps the server HTML of $path (OS dark: $systemDark, stored: $stored) while its chunk loads',
    async ({ path, ...preference }) => {
      const { serverMain, removedWhileLoading, textWhileLoading, mainRemovals, recoverableErrors } = await serverRenderThenHydrate(path, preference);
      // While the chunk downloads: the page the server sent, never blanked.
      expect(removedWhileLoading).toEqual([]);
      expect(textWhileLoading).toContain(PAGES[path].heading);
      // Once it arrives: the same element, hydrated in place.
      expect(mainRemovals).toEqual([]);
      expect(container?.querySelector('main')).toBe(serverMain);
      expect(recoverableErrors).toEqual([]);
    },
    30_000,
  );

  it('settles the stored theme once the page hydrates', async () => {
    await serverRenderThenHydrate('/pricing', { systemDark: false, stored: 'dark' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  }, 30_000);
});
