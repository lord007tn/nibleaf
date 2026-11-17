// @vitest-environment jsdom

/**
 * The page the draft preview opens on, through the route: the same page the
 * reader serves at that language's site root once the drafts are published
 * (`resolveSitePage`, the reader's own resolver, is the oracle). Issue #623.
 */
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { resolveSitePage } from '@nibleaf/shared/site-route';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch, Language, PageNode } from '@/hooks/api/types';

interface Draft extends PageNode {
  content: string;
}

const state = vi.hoisted(() => ({
  projectId: 'project-1',
  search: {} as { branchId?: string; languageId?: string; pageId?: string },
  drafts: [] as Draft[],
  languages: [] as Language[],
  branches: [] as Branch[],
  /** Language ids whose page list is still loading. */
  loading: new Set<string>(),
  /** Language ids whose page list failed. */
  failing: new Set<string>(),
  pageListCalls: [] as Array<{ projectId: string | undefined; languageId?: string; branchId?: string }>,
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    fullPath: '/app/projects/$projectId/preview',
    useParams: () => ({ projectId: state.projectId }),
    useSearch: () => state.search,
  }),
  Link: ({ children }: { children?: ReactNode }) => <a href="/link">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'viewer' } }, isPending: false }) }));
vi.mock('@/hooks/api', () => ({
  useBranches: () => ({ data: state.branches }),
  useLanguages: () => ({ data: state.languages }),
  // The dashboard's draft endpoints: a page list per project, language and version.
  usePages: (projectId: string | undefined, languageId?: string, branchId?: string) => {
    state.pageListCalls.push({ projectId, languageId, branchId });
    if (!projectId || (languageId && state.loading.has(languageId))) return { data: undefined, isPending: true, isError: false };
    if (languageId && state.failing.has(languageId)) return { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    const data = state.drafts
      .filter((page) => page.languageId === languageId && page.branchId === branchId)
      .map(({ content: _content, ...node }) => node);
    return { data, isPending: false, isError: false };
  },
  usePage: (projectId: string | undefined, pageId: string | undefined) => ({
    data: projectId ? state.drafts.find((page) => page.id === pageId) : undefined,
    isPending: !projectId || !pageId,
    isError: false,
  }),
  useProject: () => ({ data: { id: state.projectId, config: {} }, isPending: false }),
  useProjectMembers: () => ({ data: { members: [{ role: 'admin', user: { id: 'viewer' } }] }, isPending: false, isError: false }),
}));
vi.mock('@/hooks/api/query-options', () => ({ pageQueryOptions: vi.fn() }));
vi.mock('@/hooks/api/route-prefetch', () => ({
  defaultScopeId: (items?: Array<{ id: string; isDefault: boolean }>) => (items?.find((item) => item.isDefault) ?? items?.[0])?.id,
  prefetchScopedPages: vi.fn(),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/components/editor/docs-version', () => ({ publishedVersionSlugFor: () => undefined }));
vi.mock('@/components/markdown', () => ({ Markdown: ({ content }: { content: string }) => <p data-body="">{content}</p>, useMathReady: () => true }));
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

import { prefetchScopedPages } from '@/hooks/api/route-prefetch';
import { Route } from './preview';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const ProjectPreview = Route.options.component as unknown as ComponentType;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const language = (code: 'en' | 'ar', n: number, isDefault: boolean): Language => ({
  id: `lang-${code}`,
  projectId: 'project-1',
  code,
  label: code === 'en' ? 'English' : 'العربية',
  direction: code === 'ar' ? 'RTL' : 'LTR',
  isDefault,
  position: n,
});

const branch = (name: string, isDefault: boolean): Branch => ({
  id: `branch-${name}`,
  projectId: 'project-1',
  name,
  isDefault,
  forkedAt: null,
  createdAt: '2026-11-17T00:00:00.000Z',
  updatedAt: '2026-11-17T00:00:00.000Z',
});

type DraftFields = Pick<PageNode, 'title' | 'position'> &
  Partial<Pick<PageNode, 'kind' | 'parentId' | 'path' | 'hidden' | 'translationKey' | 'branchId'>>;

let nextId = 1;
/** One draft page as the dashboard API returns it; none of them has ever been published. */
const draft = (code: 'en' | 'ar', fields: DraftFields): Draft => {
  const pageId = id(nextId++);
  const path = fields.path ?? `${code}-${fields.position}`;
  return {
    id: pageId,
    parentId: null,
    branchId: 'branch-main',
    languageId: `lang-${code}`,
    kind: 'PAGE',
    slug: path,
    path,
    icon: null,
    description: null,
    hidden: false,
    translationKey: null,
    updatedAt: '2026-11-17T00:00:00.000Z',
    content: `Body of ${fields.title}`,
    ...fields,
  };
};

/** The drafts as a publish snapshots them for the live reader: every language and version. */
const publishedSnapshot = (): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Fictional docs',
    slug: 'fictional-docs',
    description: null,
    icon: null,
    config: null,
    languages: state.languages.map((lang) => ({
      code: lang.code,
      label: lang.label,
      direction: lang.direction,
      isDefault: lang.isDefault,
      enabled: true,
      config: null,
    })),
    versions: state.branches.map((version) => ({
      id: version.id,
      name: version.name,
      // The published version prefix is the version's name (`/v2/…`).
      slug: version.name,
      isDefault: version.isDefault,
    })),
  },
  pages: state.drafts.map(
    (page): SnapshotPage => ({
      id: page.id,
      parentId: page.parentId,
      versionId: page.branchId ?? '',
      updatedAt: page.updatedAt,
      languageCode: state.languages.find((lang) => lang.id === page.languageId)?.code ?? '',
      kind: page.kind,
      title: page.title,
      slug: page.slug,
      path: page.path,
      icon: page.icon,
      description: page.description,
      content: page.content,
      config: page.config ?? null,
      translationKey: page.translationKey ?? null,
      position: page.position,
      hidden: page.hidden,
    }),
  ),
  generatedAt: '2026-11-17T00:00:00.000Z',
});

/** The page the reader serves at this language's site root (in this version, when named). */
const readerHome = (code: string, version?: string) => resolveSitePage(publishedSnapshot(), '', code, version)?.page;

const idOf = (title: string) => state.drafts.find((page) => page.title === title)?.id;

describe('the draft preview opens on the reader’s home (#623)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => root.render(<ProjectPreview />));
  };
  const shownTitle = () => container.querySelector('article h1')?.textContent ?? null;
  const currentNav = () => container.querySelector('[data-preview-nav] [aria-current="page"]')?.textContent ?? null;
  const navButtons = () => [...container.querySelectorAll('[data-preview-nav] button')].map((button) => button.textContent);

  beforeEach(() => {
    nextId = 1;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    state.projectId = 'project-1';
    state.search = {};
    state.languages = [language('en', 0, true), language('ar', 1, false)];
    state.branches = [branch('main', true)];
    state.loading.clear();
    state.failing.clear();
    state.pageListCalls = [];
    vi.mocked(prefetchScopedPages).mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** English home first; its Arabic translation is the Arabic nav's second page. */
  const translatedSite = () => {
    state.drafts = [
      draft('en', { title: 'Welcome', position: 0, path: 'welcome', translationKey: 'home' }),
      draft('en', { title: 'Install', position: 1, path: 'install', translationKey: 'install' }),
      draft('ar', { title: 'التثبيت', position: 0, path: 'tathbit', translationKey: 'install' }),
      draft('ar', { title: 'مرحبا', position: 1, path: 'marhaban', translationKey: 'home' }),
    ];
  };

  it('opens a translated language on the translation of the default home, not its first page', async () => {
    translatedSite();
    state.search = { languageId: 'lang-ar' };
    await render();
    const home = readerHome('ar');
    expect(home?.title).toBe('مرحبا');
    expect(shownTitle()).toBe(home?.title);
    // The nav keeps the author's order; only the selection moves to the home.
    expect(navButtons()).toEqual(['التثبيت', 'مرحبا']);
    expect(currentNav()).toBe('مرحبا');
  });

  it('opens the default language on its home', async () => {
    translatedSite();
    await render();
    expect(shownTitle()).toBe('Welcome');
    expect(shownTitle()).toBe(readerHome('en')?.title);
    // No second list is needed for the default language.
    expect(state.pageListCalls.every((call) => call.languageId === 'lang-en' || call.projectId === undefined)).toBe(true);
  });

  it('finds a translation without a translation key by its address', async () => {
    state.drafts = [
      draft('en', { title: 'Overview', position: 0, path: 'overview' }),
      draft('ar', { title: 'البدء', position: 0, path: 'start' }),
      draft('ar', { title: 'نظرة عامة', position: 1, path: 'overview' }),
    ];
    state.search = { languageId: 'lang-ar' };
    await render();
    expect(shownTitle()).toBe('نظرة عامة');
    expect(shownTitle()).toBe(readerHome('ar')?.title);
  });

  it('falls back to the language’s first page in nav order when the home has no translation', async () => {
    state.drafts = [
      draft('en', { title: 'Welcome', position: 0, translationKey: 'home' }),
      draft('ar', { title: 'التثبيت', position: 0, translationKey: 'install' }),
      draft('ar', { title: 'الأسئلة', position: 1, translationKey: 'faq' }),
    ];
    state.search = { languageId: 'lang-ar' };
    await render();
    expect(shownTitle()).toBe('التثبيت');
    expect(shownTitle()).toBe(readerHome('ar')?.title);
  });

  it('lets a visible page with an empty address win over the translation', async () => {
    translatedSite();
    state.drafts.push(draft('ar', { title: 'الجذر', position: 2, path: '' }));
    state.search = { languageId: 'lang-ar' };
    await render();
    expect(shownTitle()).toBe('الجذر');
    expect(shownTitle()).toBe(readerHome('ar')?.title);
  });

  it('skips a hidden translation, and finds one inside a group', async () => {
    translatedSite();
    const arHome = state.drafts.find((page) => page.title === 'مرحبا');
    if (!arHome) throw new Error('fixture');
    arHome.hidden = true;
    state.search = { languageId: 'lang-ar' };
    await render();
    expect(shownTitle()).toBe('التثبيت');
    expect(shownTitle()).toBe(readerHome('ar')?.title);

    arHome.hidden = false;
    const group = draft('ar', { title: 'البداية', position: 2, kind: 'GROUP', path: 'bidaya' });
    state.drafts.push(group);
    arHome.parentId = group.id;
    arHome.position = 0;
    await render();
    expect(readerHome('ar')?.title).toBe('مرحبا');
    expect(shownTitle()).toBe('مرحبا');
    expect(currentNav()).toBe('مرحبا');
  });

  it('opens nothing for a language with no drafts yet, and its own first page when the default has none', async () => {
    state.drafts = [draft('en', { title: 'Welcome', position: 0, translationKey: 'home' })];
    state.search = { languageId: 'lang-ar' };
    await render();
    // The reader falls back to the default language here; the preview lists one language at a time.
    expect(readerHome('ar')?.title).toBe('Welcome');
    expect(shownTitle()).toBeNull();
    expect(container.textContent).toContain('preview.empty');

    state.drafts = [draft('ar', { title: 'التثبيت', position: 0 }), draft('ar', { title: 'الأسئلة', position: 1 })];
    await render();
    expect(shownTitle()).toBe('التثبيت');
    expect(shownTitle()).toBe(readerHome('ar')?.title);
  });

  it('chooses the home within the previewed version, from that version’s drafts', async () => {
    state.branches = [branch('main', true), branch('v2', false)];
    translatedSite();
    // In v2 the Arabic home's translation sits first; in main it sits second.
    state.drafts.push(
      draft('en', { title: 'Install v2', position: 0, path: 'install', translationKey: 'install', branchId: 'branch-v2' }),
      draft('en', { title: 'Welcome v2', position: 1, path: 'welcome', translationKey: 'home', branchId: 'branch-v2' }),
      draft('ar', { title: 'مرحبا ٢', position: 0, path: 'marhaban', translationKey: 'home', branchId: 'branch-v2' }),
      draft('ar', { title: 'التثبيت ٢', position: 1, path: 'tathbit', translationKey: 'install', branchId: 'branch-v2' }),
    );
    state.search = { languageId: 'lang-ar', branchId: 'branch-v2' };
    await render();
    expect(readerHome('ar', 'v2')?.title).toBe('التثبيت ٢');
    expect(shownTitle()).toBe('التثبيت ٢');
    expect(state.pageListCalls).toContainEqual({ projectId: 'project-1', languageId: 'lang-en', branchId: 'branch-v2' });

    state.search = { languageId: 'lang-ar', branchId: 'branch-main' };
    await render();
    expect(shownTitle()).toBe(readerHome('ar', 'main')?.title);
    expect(shownTitle()).toBe('مرحبا');
  });

  it('follows language, project and deep-link changes', async () => {
    translatedSite();
    await render();
    expect(shownTitle()).toBe('Welcome');
    state.search = { languageId: 'lang-ar' };
    await render();
    expect(shownTitle()).toBe('مرحبا');
    // A page picked in the nav (or linked) still wins over the home.
    state.search = { languageId: 'lang-ar', pageId: idOf('التثبيت') };
    await render();
    expect(shownTitle()).toBe('التثبيت');
    // Another site, whose default language is Arabic: English is now the translation.
    state.projectId = 'project-2';
    state.languages = [language('ar', 0, true), language('en', 1, false)];
    state.search = { languageId: 'lang-en' };
    await render();
    expect(readerHome('en')?.title).toBe('Install');
    expect(shownTitle()).toBe('Install');
  });

  it('waits for the default language’s drafts before opening, and opens its own home if they fail', async () => {
    translatedSite();
    state.search = { languageId: 'lang-ar' };
    state.loading.add('lang-en');
    await render();
    expect(shownTitle()).toBeNull();
    expect(container.querySelector('article')?.getAttribute('aria-busy')).toBe('true');
    state.loading.clear();
    await render();
    expect(shownTitle()).toBe('مرحبا');

    state.failing.add('lang-en');
    await render();
    expect(shownTitle()).toBe('التثبيت');
  });

  it('prefetches the default language’s drafts when the address names another language', () => {
    const loader = Route.options.loader as unknown as (args: unknown) => void;
    loader({ context: { queryClient: {} }, params: { projectId: 'project-1' }, deps: { languageId: 'lang-ar', branchId: 'branch-v2' } });
    expect(prefetchScopedPages).toHaveBeenCalledWith({}, 'project-1', { branchId: 'branch-v2', languageId: 'lang-ar' });
    expect(prefetchScopedPages).toHaveBeenCalledWith({}, 'project-1', { branchId: 'branch-v2' });
  });
});
