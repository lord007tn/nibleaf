// @vitest-environment jsdom

import { PassThrough } from 'node:stream';
import { act, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToPipeableStream } from 'react-dom/server.node';
import { afterEach, expect, it, vi } from 'vitest';
import type { NavNode } from '@/hooks/api';
import type { SitePage } from '@/hooks/api/types';
import type { SiteReaderContextValue } from './site-reader-context';

vi.mock('@/components/site/page-alternates-context', () => ({ useSitePageAlternates: () => ({ setAlternates: vi.fn() }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
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

const shell: SiteReaderContextValue = {
  lang: 'ar',
  homeHref: '/',
  languages: [
    { code: 'en', direction: 'LTR' },
    { code: 'ar', direction: 'RTL' },
  ],
};

const nav: NavNode[] = [
  { id: 'refund', kind: 'PAGE', title: 'PMS خطوات إسترداد مبلغ', path: 'refund', icon: null, tag: null, children: [] },
  { id: 'setup', kind: 'PAGE', title: 'Setup', path: 'setup', icon: null, tag: null, children: [] },
];

const data: SitePage = {
  project: { id: 'docs', name: 'Docs', slug: 'docs', description: null, primaryDomain: null, config: { addons: { feedback: false } } },
  page: {
    id: 'page-1',
    title: 'Add a new reservation',
    path: 'reservations',
    content: [
      'Open the front desk calendar.',
      'Nibleaf يتيح لك إدارة الحجوزات بسهولة.',
      '- العنصر الأول\n- The second item',
      '| Product | Quantity |\n| --- | --- |\n| غرفة مزدوجة | 2 |',
      '```bash\npnpm install\n```',
    ].join('\n\n'),
    description: null,
    excerpt: '',
    icon: null,
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
    headings: [{ id: 'steps', text: 'خطوات الحجز', depth: 2 }],
    config: null,
  },
  activeLanguage: 'en',
  activeVersion: 'main',
  languageConfig: null,
  versions: [{ id: 'version-1', name: 'Main', slug: 'main', isDefault: true }],
  languages: [{ code: 'en', isDefault: true, path: 'reservations' }],
  breadcrumbs: [{ title: 'Add a new reservation', path: 'reservations' }],
  prev: null,
  next: null,
};

/** The reader chrome pieces, from one module graph. Server and client each get
 *  their own graph, as in production, so their contexts never collide. */
async function loadReader() {
  const [{ SiteNav }, { SitePageView }, { SiteReaderContext }, { TableOfContents }] = await Promise.all([
    import('./site-nav'),
    import('./site-page-view'),
    import('./site-reader-context'),
    import('./toc'),
    // The code-split article renderer, loaded before rendering as the reader's loaders do.
    import('@/components/markdown'),
  ]);
  return function Reader() {
    return (
      <SiteReaderContext.Provider value={shell}>
        <SiteNav nodes={nav} projectId="docs" currentPath="refund" toggleLabel="Toggle" />
        <TableOfContents headings={data.page.headings} label="On this page" />
        <SitePageView projectId="docs" lang="ar" data={data} />
      </SiteReaderContext.Provider>
    );
  };
}

/** Every direction attribute in the tree, with the element it sits on. */
const directionAttributes = (element: Element): string[] =>
  [...element.querySelectorAll('[dir], [lang]')].map(
    (node) => `${node.tagName.toLowerCase()} lang=${node.getAttribute('lang')} dir=${node.getAttribute('dir')} ${node.textContent?.slice(0, 24)}`,
  );

it('hydrates the per-block direction attributes without a mismatch', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  const ServerReader = await loadReader();
  container.innerHTML = await renderCompleteHtml(<ServerReader />);
  document.body.append(container);
  const serverAttributes = directionAttributes(container);
  const serverNodes = [...container.querySelectorAll('[dir]')];
  // The server HTML carries the attributes this test is about.
  expect(serverAttributes).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^article lang=en dir=ltr/),
      expect.stringMatching(/^p lang=null dir=rtl Nibleaf/),
      expect.stringMatching(/^span lang=null dir=rtl PMS/),
      expect.stringMatching(/^table lang=null dir=ltr/),
      expect.stringMatching(/^pre lang=null dir=ltr/),
    ]),
  );

  vi.resetModules();
  const ClientReader = await loadReader();
  const consoleErrors = vi.spyOn(console, 'error');
  const recoverableErrors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container as HTMLDivElement, <ClientReader />, { onRecoverableError: (error) => recoverableErrors.push(error) });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(recoverableErrors).toEqual([]);
  expect(consoleErrors).not.toHaveBeenCalled();
  // Same attributes on the same nodes: hydration adopted the server DOM.
  expect(directionAttributes(container)).toEqual(serverAttributes);
  const hydratedNodes = [...container.querySelectorAll('[dir]')];
  expect(hydratedNodes).toHaveLength(serverNodes.length);
  expect(hydratedNodes.every((node, index) => node === serverNodes[index])).toBe(true);
}, 30_000);
