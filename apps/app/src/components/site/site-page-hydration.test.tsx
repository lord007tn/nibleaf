// @vitest-environment jsdom

import { PassThrough } from 'node:stream';
import { act, type ReactNode, useEffect, useState } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server.node';
import { afterEach, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import type { SiteLanguageAlternate } from './page-alternates-context';

vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

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
  vi.resetModules();
  vi.unstubAllGlobals();
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

/** What the router's `hydrate` hook does in the browser (see router.tsx). */
const runRouterHydrateHook = async () => {
  const { loadServerRenderedModules } = await import('@/lib/hydration-modules');
  await loadServerRenderedModules(document, () => import('@/lib/reader-hydration-modules').then((module) => module.readerHydrationModules));
};

/** Server-renders `data`, then hydrates it with a fresh (cold) client module
 *  graph, recording any removal of the server's article body. `beforeHydrate` runs
 *  where the router's `hydrate` hook does. */
async function serverRenderThenHydrate(data: SitePage, beforeHydrate: () => Promise<void> = runRouterHydrateHook) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
  expect(richRequests).toBe(1);
  expect(serverBody?.getAttribute('data-hydration-module')).toBe('markdown-rich');
  expect(serverBody?.parentElement?.getAttribute('data-hydration-module')).toBe('markdown');
  expect(bodyRemovals).toEqual([]);
  expect(container?.querySelector('article .typeset')).toBe(serverBody);
  expect(container?.textContent).toContain('Raw MDX needs the rich renderer.');
  expect(container?.querySelector('article .katex')).not.toBeNull();
  expect(recoverableErrors).toEqual([]);
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
