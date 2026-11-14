// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queries = vi.hoisted(() => ({}) as Record<'project' | 'pages' | 'page', unknown>);
const search = vi.hoisted(() => ({}) as { pageId?: string });

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    fullPath: '/app/projects/$projectId/preview',
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => search,
  }),
  Link: ({ children }: { children?: ReactNode }) => <a href="/link">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'viewer' } }, isPending: false }) }));
vi.mock('@/hooks/api', () => ({
  useBranches: () => ({ data: [] }),
  useLanguages: () => ({ data: [{ id: 'lang-en', code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 }] }),
  usePage: () => queries.page,
  usePages: () => queries.pages,
  useProject: () => queries.project,
  useProjectMembers: () => ({ data: { members: [{ role: 'admin', user: { id: 'viewer' } }] }, isPending: false, isError: false }),
}));
vi.mock('@/hooks/api/query-options', () => ({ pageQueryOptions: vi.fn() }));
vi.mock('@/hooks/api/route-prefetch', () => ({
  defaultScopeId: (items?: Array<{ id: string }>) => items?.[0]?.id,
  prefetchScopedPages: vi.fn(),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/components/editor/docs-version', () => ({ publishedVersionSlugFor: () => undefined }));
vi.mock('@/components/markdown', () => ({ Markdown: () => null }));
vi.mock('@/components/site/page-icon', () => ({ PageIcon: () => null }));
vi.mock('@/layouts/project', () => ({ PublishControl: () => null }));
vi.mock('@/lib/site-theme', () => ({ projectThemeStyle: () => ({}), projectThemeVariables: () => ({}), resolveProjectTheme: () => undefined }));
vi.mock('@/components/site/documentation-theme-provider', () => ({
  DocumentationThemeProvider: ({ children }: { children?: ReactNode }) => <div data-site-theme="">{children}</div>,
  DocumentationProjectPreviewLayout: ({ content, navigation }: { content: ReactNode; navigation: ReactNode }) => (
    <div>
      {navigation}
      {content}
    </div>
  ),
}));

import { Route } from './preview';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const ProjectPreview = Route.options.component as unknown as ComponentType;

describe('preview content', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    queries.project = { data: { id: 'project-1', config: {} } };
    queries.page = { data: undefined, isPending: false, isError: false };
    search.pageId = undefined;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('offers a retry, not "no draft pages", when the page list fails to load', async () => {
    const refetch = vi.fn();
    queries.pages = { data: undefined, isPending: false, isError: true, isFetching: false, refetch };
    await act(async () => root.render(<ProjectPreview />));
    expect(container.textContent).not.toContain('preview.empty');
    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button');
    await act(async () => retry?.click());
    expect(refetch).toHaveBeenCalled();
  });

  it('still says there is nothing to preview when the site really has no pages', async () => {
    queries.pages = { data: [], isPending: false, isError: false };
    await act(async () => root.render(<ProjectPreview />));
    expect(container.textContent).toContain('preview.empty');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an untitled page as "Untitled", as readers will see it', async () => {
    const untitled = {
      id: 'p1',
      kind: 'PAGE',
      title: '',
      path: 'untitled-2',
      slug: 'untitled-2',
      icon: null,
      description: null,
      content: 'Body',
      parentId: null,
      position: 0,
      hidden: false,
    };
    queries.pages = { data: [untitled], isPending: false, isError: false };
    queries.page = { data: untitled, isPending: false, isError: false };
    await act(async () => root.render(<ProjectPreview />));
    expect(container.querySelector('h1')?.textContent).toBe('Untitled');
  });

  it('opens each page at its top, not where the previous one was scrolled to', async () => {
    const pageA = {
      id: 'a',
      kind: 'PAGE',
      title: 'A',
      path: 'a',
      slug: 'a',
      icon: null,
      description: null,
      content: 'A',
      parentId: null,
      position: 0,
      hidden: false,
    };
    const pageB = { ...pageA, id: 'b', title: 'B', path: 'b', slug: 'b', position: 1 };
    queries.pages = { data: [pageA, pageB], isPending: false, isError: false };
    queries.page = { data: pageA, isPending: false, isError: false };
    search.pageId = 'a';
    await act(async () => root.render(<ProjectPreview />));
    const content = container.querySelector<HTMLElement>('[data-theme-region="preview-main"]');
    if (!content) throw new Error('Preview content not rendered');
    content.scrollTop = 480;
    search.pageId = 'b';
    queries.page = { data: pageB, isPending: false, isError: false };
    await act(async () => root.render(<ProjectPreview />));
    expect(content.scrollTop).toBe(0);
  });

  // P1-DASH-003: the preview listed every page flat by position, mixing group
  // children in with top-level pages.
  it('lists pages in the reader’s structure and order, and opens on the first page', async () => {
    const base = { icon: null, description: null, content: '', hidden: false };
    const pages = [
      { ...base, id: 'faq', kind: 'PAGE', title: 'FAQ', parentId: null, position: 2 },
      { ...base, id: 'api', kind: 'GROUP', title: 'API reference', parentId: null, position: 1 },
      { ...base, id: 'auth', kind: 'PAGE', title: 'Authentication', parentId: 'api', position: 0 },
      { ...base, id: 'start', kind: 'PAGE', title: 'Getting started', parentId: null, position: 0 },
      { ...base, id: 'draft', kind: 'PAGE', title: 'Hidden draft', parentId: null, position: 3, hidden: true },
    ];
    queries.pages = { data: pages.map((page) => ({ ...page, slug: page.id, path: page.id })), isPending: false, isError: false };
    queries.page = { data: pages[3], isPending: false, isError: false };
    await act(async () => root.render(<ProjectPreview />));
    const nav = container.querySelector('[data-preview-nav]');
    expect([...(nav?.querySelectorAll('button') ?? [])].map((button) => button.textContent)).toEqual(['Getting started', 'Authentication', 'FAQ']);
    // The group is a section label, not a disabled button, and holds its pages.
    const section = [...(nav?.querySelectorAll('p') ?? [])].find((label) => label.textContent === 'API reference');
    expect(section?.closest('li')?.textContent).toContain('Authentication');
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe('Getting started');
    expect(nav?.querySelector('[data-nav-block-start]')?.textContent).toBe('FAQ');
  });

  it('keeps the authoring chrome outside the site theme', async () => {
    queries.pages = { data: [], isPending: false, isError: false };
    await act(async () => root.render(<ProjectPreview />));
    const chrome = container.querySelector('[data-preview-app-chrome]');
    expect(chrome).not.toBeNull();
    expect(chrome?.closest('[data-site-theme]')).toBeNull();
    expect(container.querySelector('[data-site-theme]')).not.toBeNull();
  });
});
