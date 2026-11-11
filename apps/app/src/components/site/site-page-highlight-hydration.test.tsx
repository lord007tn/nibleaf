// @vitest-environment jsdom

import { PassThrough } from 'node:stream';
import { act, type ReactNode, useEffect, useState } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server.node';
import { afterEach, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import type { SiteLanguageAlternate } from './page-alternates-context';

/*
 * Code in a language outside the article renderer's core grammars (Rust here)
 * loads its grammar per article. The server renders it highlighted, and the
 * browser loads the grammar before hydrating, so the highlighted markup stays
 * exactly as sent: no mismatch, no plain-text flash, no layout shift.
 */

vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@/routeTree.gen', async () => {
  const { createRootRoute } = await import('@tanstack/react-router');
  return { routeTree: createRootRoute() };
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let release: (() => void) | undefined;

afterEach(async () => {
  release?.();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  release = undefined;
  vi.doUnmock('@/components/site/highlight-grammars');
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

/** The reader as the site layout mounts it, settling once after hydrating. */
const createReader = async () => {
  const { SitePageView } = await import('./site-page-view');
  const { SitePageAlternatesContext } = await import('./page-alternates-context');
  return function Reader({ data }: { data: SitePage }) {
    const [alternates, setAlternates] = useState<SiteLanguageAlternate[]>([]);
    const [, setSettled] = useState(false);
    useEffect(() => setSettled(true), []);
    return (
      <SitePageAlternatesContext.Provider value={{ alternates, setAlternates }}>
        <SitePageView data={data} lang={data.activeLanguage} projectId="project-1" />
      </SitePageAlternatesContext.Provider>
    );
  };
};

const sitePage = (content: string): SitePage => ({
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
  activeLanguage: 'en',
  activeVersion: 'main',
  languageConfig: null,
  versions: [{ id: 'version-1', name: 'Main', slug: 'main', isDefault: true }],
  languages: [{ code: 'en', isDefault: true, path: 'guide' }],
  breadcrumbs: [{ title: 'Guide', path: 'guide' }],
  prev: null,
  next: null,
});

const runRouterHydrateHook = async () => {
  const { getRouter } = await import('@/router');
  await getRouter().options.hydrate?.(undefined as never);
};

/** Counts downloads of the lazy grammars' chunk; `gate` holds them until released. */
const watchGrammarChunk = (gate?: Promise<void>) => {
  const downloads = { count: 0 };
  vi.doMock('@/components/site/highlight-grammars', async (importOriginal) => {
    downloads.count++;
    await gate;
    return importOriginal();
  });
  return downloads;
};

/** Server-renders `data`, then hydrates it with a fresh (cold) client module
 *  graph, recording the markup of every code block hydration inserts. (Outside
 *  the React Compiler, as here, the article's code blocks remount when the
 *  reader re-renders, so their nodes can change; their markup must not.) */
async function serverRenderThenHydrate(data: SitePage, beforeHydrate: () => Promise<void> = runRouterHydrateHook) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await (await import('@/lib/reader-hydration-modules')).loadArticleRenderer(data.page.content);
  const ServerReader = await createReader();
  container = document.createElement('div');
  container.innerHTML = await renderCompleteHtml(<ServerReader data={data} />);
  document.body.append(container);
  const serverHtml = container.querySelector('article .typeset')?.innerHTML;
  const serverCode = [...container.querySelectorAll('pre code')].map((code) => code.outerHTML);
  const insertedCode: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) insertedCode.push(...[...node.querySelectorAll('pre code')].map((code) => code.outerHTML));
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  const recoverableErrors: unknown[] = [];
  try {
    vi.resetModules();
    await beforeHydrate();
    const ClientReader = await createReader();
    await act(async () => {
      root = hydrateRoot(container as HTMLDivElement, <ClientReader data={data} />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  } finally {
    observer.disconnect();
  }
  return { serverHtml, serverCode, insertedCode, recoverableErrors };
}

const content = 'Install, then run it:\n\n```bash\ncargo run\n```\n\n```rust\nfn main() {\n    println!("hello");\n}\n```';
const codeBlocks = () => [...(container?.querySelectorAll('pre code') ?? [])];

it('server-renders code in a lazily loaded language highlighted, and hydrates it unchanged', async () => {
  let downloads = { count: 0 };
  const { serverHtml, serverCode, insertedCode, recoverableErrors } = await serverRenderThenHydrate(sitePage(content), async () => {
    // A slow grammar chunk: hydration waits for it rather than rendering the plain fallback.
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    downloads = watchGrammarChunk(gate);
    const hydrating = runRouterHydrateHook();
    await new Promise((resolve) => setTimeout(resolve, 20));
    release?.();
    await hydrating;
  });

  // Rust highlighted by its lazily loaded grammar, Bash by a core one.
  const [bash, rust] = codeBlocks();
  expect(rust?.className).toBe('hljs language-rust');
  expect(rust?.querySelector('.hljs-keyword')?.textContent).toBe('fn');
  expect(rust?.querySelector('.hljs-string')?.textContent).toBe('"hello"');
  expect(bash?.className).toBe('hljs language-bash');
  expect(rust?.closest('[data-hydration-module~="hljs-rust"]')).not.toBeNull();

  // Hydrating never showed anything but the server's markup: no plain-text
  // fallback and no mismatch, so nothing to shift.
  expect(recoverableErrors).toEqual([]);
  expect(codeBlocks().map((code) => code.outerHTML)).toEqual(serverCode);
  for (const inserted of insertedCode) expect(serverCode).toContain(inserted);
  expect(container?.querySelector('article .typeset')?.innerHTML).toBe(serverHtml);
  // The router's hook loaded the Rust grammar once, before hydrating.
  expect(downloads.count).toBe(1);
}, 30_000);

it('loads no lazy grammar for an article whose code uses only core languages', async () => {
  let downloads = { count: 0 };
  const { recoverableErrors } = await serverRenderThenHydrate(sitePage('```ts\nconst a: number = 1;\n```'), async () => {
    downloads = watchGrammarChunk();
    await runRouterHydrateHook();
  });
  expect(codeBlocks()[0]?.querySelector('.hljs-keyword')?.textContent).toBe('const');
  expect(container?.querySelector('[data-hydration-module*="hljs-"]')).toBeNull();
  expect(recoverableErrors).toEqual([]);
  expect(downloads.count).toBe(0);
}, 30_000);
