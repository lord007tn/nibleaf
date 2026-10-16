// @vitest-environment jsdom

import { PassThrough } from 'node:stream';
import { act, type ReactNode, useState } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server.node';
import { afterEach, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import type { SiteLanguageAlternate } from './page-alternates-context';

vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let releaseMarkdown: (() => void) | undefined;

afterEach(async () => {
  releaseMarkdown?.();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  releaseMarkdown = undefined;
  vi.doUnmock('@/components/markdown');
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

const createReader = (
  Page: typeof import('./site-page-view').SitePageView,
  Provider: typeof import('./page-alternates-context').SitePageAlternatesContext.Provider,
) =>
  function Reader({ data }: { data: SitePage }) {
    const [alternates, setAlternates] = useState<SiteLanguageAlternate[]>([]);
    return (
      <Provider value={{ alternates, setAlternates }}>
        <Page data={data} lang={data.activeLanguage} projectId="project-1" />
      </Provider>
    );
  };

it.each(['en', 'ar'])(
  'keeps one readable %s article while hydration updates language alternates',
  async (language) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const body = language === 'ar' ? 'يبقى نص الدليل متاحاً.' : 'The guide remains readable.';
    const data: SitePage = {
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
        content: `${body}\n\n[Details](/details)`,
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
    };
    const serverPage = await import('./site-page-view');
    const serverContext = await import('./page-alternates-context');
    const ServerReader = createReader(serverPage.SitePageView, serverContext.SitePageAlternatesContext.Provider);
    container = document.createElement('div');
    container.innerHTML = await renderCompleteHtml(<ServerReader data={data} />);
    document.body.append(container);
    const paragraphs = () => [...(container?.querySelectorAll('article p') ?? [])].filter((node) => node.textContent === body);
    const originalParagraph = paragraphs()[0];
    expect(originalParagraph).toBeDefined();
    const observedCounts = [paragraphs().length];
    const observer = new MutationObserver(() => observedCounts.push(paragraphs().length));
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    const recoverableErrors: unknown[] = [];
    try {
      // Server and browser have separate lazy-module caches. Hold the cold client
      // renderer pending while the real language-alternates effect updates its provider.
      vi.resetModules();
      const pendingMarkdown = new Promise<void>((resolve) => {
        releaseMarkdown = resolve;
      });
      vi.doMock('@/components/markdown', async (importOriginal) => {
        await pendingMarkdown;
        return importOriginal();
      });
      const clientPage = await import('./site-page-view');
      const clientContext = await import('./page-alternates-context');
      const ClientReader = createReader(clientPage.SitePageView, clientContext.SitePageAlternatesContext.Provider);
      await act(async () => {
        root = hydrateRoot(container as HTMLDivElement, <ClientReader data={data} />, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(paragraphs()).toEqual([originalParagraph]);
      await act(async () => {
        releaseMarkdown?.();
        await pendingMarkdown;
      });
      expect(paragraphs()).toEqual([originalParagraph]);
      expect(observedCounts.every((count) => count === 1)).toBe(true);
      expect(container.querySelectorAll('article a[href*="/details"]')).toHaveLength(1);
      expect(recoverableErrors).toEqual([]);
    } finally {
      observer.disconnect();
    }
  },
  30_000,
);
