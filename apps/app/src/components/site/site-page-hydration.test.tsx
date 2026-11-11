// @vitest-environment jsdom

import { PassThrough } from 'node:stream';
import { act, type ReactNode, useEffect, useState } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server.node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import type { SiteLanguageAlternate } from './page-alternates-context';

vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
// The router as the app configures it (`getRouter()` in router.tsx), with an
// empty route tree: the tests call its `hydrate` option, not a copy of it.
vi.mock('@/routeTree.gen', async () => {
  const { createRootRoute } = await import('@tanstack/react-router');
  return { routeTree: createRootRoute() };
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let releaseRich: (() => void) | undefined;

afterEach(async () => {
  releaseRich?.();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  releaseRich = undefined;
  vi.doUnmock('@/components/markdown-rich');
  vi.doUnmock('@/components/markdown');
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

type ReaderModules = {
  page: typeof import('./site-page-view');
  context: typeof import('./page-alternates-context');
};
const importReader = async (): Promise<ReaderModules> => ({
  page: await import('./site-page-view'),
  context: await import('./page-alternates-context'),
});

/** The reader as the site layout mounts it. Its own state changes once right
 *  after hydrating, at default (not transition) priority, the way the reader
 *  chrome's providers settle in the browser. That re-renders the providers above
 *  the article, which is what used to replace a still-suspended article with its
 *  empty fallback. */
const createReader = ({ page: { SitePageView }, context: { SitePageAlternatesContext } }: ReaderModules) =>
  function Reader({ data }: { data: SitePage }) {
    const [alternates, setAlternates] = useState<SiteLanguageAlternate[]>([]);
    const [, setSettled] = useState(false);
    useEffect(() => setSettled(true), []);
    return (
      <SitePageAlternatesContext.Provider value={{ alternates, setAlternates }}>
        <SitePageView data={data} lang={data.activeLanguage} projectId="project-1" />
      </SitePageAlternatesContext.Provider>
    );
  };

const sitePage = (language: string, content: string): SitePage => ({
  project: {
    id: 'project-1',
    name: 'Example docs',
    slug: 'example',
    description: null,
    primaryDomain: null,
    config: { addons: { feedback: false } },
  },
  page: {
    id: 'page-1',
    title: 'Guide',
    path: 'guide',
    content,
    description: null,
    excerpt: '',
    icon: null,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    headings: [],
    config: { mode: 'center' },
  },
  activeLanguage: language,
  activeVersion: 'main',
  languageConfig: null,
  versions: [{ id: 'version-1', name: 'Main', slug: 'main', isDefault: true }],
  languages: [
    { code: 'en', isDefault: true, path: 'guide' },
    { code: 'ar', isDefault: false, path: 'guide' },
  ],
  breadcrumbs: [{ title: 'Guide', path: 'guide' }],
  prev: null,
  next: null,
});

/** The configured router's `hydrate` hook, which TanStack awaits in the
 *  browser before React hydrates. */
const runRouterHydrateHook = async () => {
  const { getRouter } = await import('@/router');
  const { hydrate } = getRouter().options;
  expect(hydrate).toBeTypeOf('function');
  await hydrate?.(undefined as never);
};

/** Server-renders `data`, then hydrates it with a fresh (cold) client module
 *  graph, recording any removal of the server's article body. `beforeHydrate` runs
 *  where the router's `hydrate` hook does. */
async function serverRenderThenHydrate(data: SitePage, beforeHydrate: () => Promise<void> = runRouterHydrateHook) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The server's loader loads the article's renderers before rendering.
  await (await import('@/lib/reader-hydration-modules')).loadArticleRenderer(data.page.content);
  const ServerReader = createReader(await importReader());
  container = document.createElement('div');
  container.innerHTML = await renderCompleteHtml(<ServerReader data={data} />);
  document.body.append(container);
  const serverBody = container.querySelector('article .typeset');
  expect(serverBody).not.toBeNull();
  const bodyRemovals: Node[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const removed of record.removedNodes) {
        if (removed === serverBody || removed.contains(serverBody)) bodyRemovals.push(removed);
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  const recoverableErrors: unknown[] = [];
  try {
    // The browser has its own module cache: nothing the server loaded counts.
    vi.resetModules();
    await beforeHydrate();
    const ClientReader = createReader(await importReader());
    await act(async () => {
      root = hydrateRoot(container as HTMLDivElement, <ClientReader data={data} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  } finally {
    observer.disconnect();
  }
  return { serverBody, bodyRemovals, recoverableErrors };
}

it.each(['en', 'ar'])(
  'keeps the server-rendered %s article through hydration while the reader re-renders',
  async (language) => {
    const text = language === 'ar' ? 'يبقى نص الدليل متاحاً.' : 'The guide remains readable.';
    const { serverBody, bodyRemovals, recoverableErrors } = await serverRenderThenHydrate(sitePage(language, `${text}\n\n[Details](/details)`));
    // The same element the server sent, never removed, not even for a moment.
    expect(bodyRemovals).toEqual([]);
    expect(container?.querySelector('article .typeset')).toBe(serverBody);
    expect([...(container?.querySelectorAll('article p') ?? [])].filter((node) => node.textContent === text)).toHaveLength(1);
    expect(container?.querySelectorAll('article a[href*="/details"]')).toHaveLength(1);
    expect(recoverableErrors).toEqual([]);
  },
  30_000,
);

it('keeps a server-rendered rich (HTML/MDX, math) article through hydration', async () => {
  const content = 'Before the card.\n\n<Note>Raw MDX needs the rich renderer.</Note>\n\nInline math $a^2$ too.';
  let richRequests = 0;
  const { serverBody, bodyRemovals, recoverableErrors } = await serverRenderThenHydrate(sitePage('en', content), async () => {
    // A slow rich-renderer chunk: hydration waits for it instead of suspending.
    const pending = new Promise<void>((resolve) => {
      releaseRich = resolve;
    });
    vi.doMock('@/components/markdown-rich', async (importOriginal) => {
      richRequests++;
      await pending;
      return importOriginal();
    });
    const hydrating = runRouterHydrateHook();
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseRich?.();
    await hydrating;
  });
  // The body first: the same element the server sent, never removed.
  expect(bodyRemovals).toEqual([]);
  expect(container?.querySelector('article .typeset')).toBe(serverBody);
  expect(container?.textContent).toContain('Raw MDX needs the rich renderer.');
  expect(container?.querySelector('article .katex')).not.toBeNull();
  expect(recoverableErrors).toEqual([]);
  // Then how: the hook loaded the marked rich renderer once, before hydrating.
  expect(richRequests).toBe(1);
  expect(serverBody?.closest('[data-hydration-module="markdown-rich"]')).not.toBeNull();
  expect(serverBody?.closest('[data-hydration-module="markdown"]')).not.toBeNull();
}, 30_000);

it('loads the rich renderer before hydrating only when the server HTML used it', async () => {
  let richRequests = 0;
  await serverRenderThenHydrate(sitePage('en', 'Plain **Markdown** only.'), async () => {
    vi.doMock('@/components/markdown-rich', async (importOriginal) => {
      richRequests++;
      return importOriginal();
    });
    await runRouterHydrateHook();
  });
  expect(container?.querySelector('[data-hydration-module="markdown-rich"]')).toBeNull();
  expect(richRequests).toBe(0);
}, 30_000);

it("the router's hook loads nothing on a page without reader markup", async () => {
  container = document.createElement('div');
  container.innerHTML = '<main><h1>Dashboard</h1></main>';
  document.body.append(container);
  const { getRouter } = await import('@/router');
  // No promise: the hook returned before importing anything.
  expect(getRouter().options.hydrate?.(undefined as never)).toBeUndefined();
});

describe('when the article renderer cannot load', () => {
  const text = 'The guide stays readable without its renderer.';
  /** Makes the browser's article-renderer chunk fail its first `failures`
   *  downloads, then load. Counts every download. */
  const failArticleRenderer = (failures: number) => {
    const downloads = { count: 0 };
    vi.doMock('@/components/markdown', async (importOriginal) => {
      downloads.count++;
      if (downloads.count <= failures) throw new Error('Failed to fetch dynamically imported module');
      return importOriginal();
    });
    return downloads;
  };
  /** Moves the retry clock on a second at a time. Between steps, real I/O
   *  turns let a mocked chunk download settle and schedule its next retry. */
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(1000, ms - elapsed));
        for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
      });
    }
  };
  const bodyText = () => [...(container?.querySelectorAll('article p') ?? [])].filter((node) => node.textContent === text);

  it('keeps the server-rendered body, with no error page, and stops retrying after a few attempts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    let downloads = { count: 0 };
    const { recoverableErrors } = await serverRenderThenHydrate(sitePage('en', text), async () => {
      downloads = failArticleRenderer(Number.POSITIVE_INFINITY);
      await runRouterHydrateHook();
    });
    expect(downloads.count).toBe(1);
    expect(bodyText()).toHaveLength(1);
    expect(container?.querySelector('[role="alert"]')).toBeNull();
    expect(recoverableErrors).toEqual([]);
    // Retries back off (1 s, 3 s, 9 s), then stop for good.
    await advance(1000);
    expect(downloads.count).toBe(2);
    await advance(60_000);
    expect(downloads.count).toBe(4);
    await advance(5 * 60_000);
    expect(downloads.count).toBe(4);
    expect(bodyText()).toHaveLength(1);
    expect(container?.querySelector('[role="alert"]')).toBeNull();
    expect(recoverableErrors).toEqual([]);
  }, 30_000);

  it('swaps in the renderer when a retry succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    let downloads = { count: 0 };
    const { recoverableErrors } = await serverRenderThenHydrate(
      sitePage(
        'en',
        `${text}

[Details](/details)`,
      ),
      async () => {
        downloads = failArticleRenderer(2);
        await runRouterHydrateHook();
      },
    );
    expect(bodyText()).toHaveLength(1);
    await advance(1000);
    expect(downloads.count).toBe(2);
    expect(bodyText()).toHaveLength(1);
    await advance(3000);
    expect(downloads.count).toBe(3);
    // The live renderer replaced the kept server markup, once.
    expect(bodyText()).toHaveLength(1);
    expect(container?.querySelectorAll('article .typeset')).toHaveLength(1);
    expect(container?.querySelectorAll('article a[href*="/details"]')).toHaveLength(1);
    expect(recoverableErrors).toEqual([]);
  }, 30_000);

  it('says so inline on a client navigation, and its retry loads the page', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const downloads = failArticleRenderer(4);
    // A navigation: the loader's download fails (and is caught), then the page
    // renders on the client with no server markup.
    const { loadArticleRenderer } = await import('@/lib/reader-hydration-modules');
    await loadArticleRenderer(text);
    expect(downloads.count).toBe(1);
    const { createRoot } = await import('react-dom/client');
    const ClientReader = createReader(await importReader());
    container = document.createElement('div');
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      root = createRoot(container as HTMLDivElement, {
        onUncaughtError: (error) => errors.push(error),
        onCaughtError: (error) => errors.push(error),
      });
      root.render(<ClientReader data={sitePage('en', text)} />);
    });
    // The page's chrome renders, with a body-shaped placeholder while retrying.
    expect(container.querySelector('article h1')?.textContent).toBe('Guide');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await advance(60_000);
    expect(downloads.count).toBe(4);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This page couldn't load.");
    expect(errors).toEqual([]);
    await act(async () => {
      alert?.querySelector('button')?.click();
    });
    expect(downloads.count).toBe(5);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // The real renderer still has to import.
    await act(async () => {
      await vi.waitFor(() => expect(bodyText()).toHaveLength(1), { timeout: 10_000 });
    });
    expect(errors).toEqual([]);
  }, 30_000);
});
