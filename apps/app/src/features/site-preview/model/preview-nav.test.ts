import { buildNavTree, type NavNode, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import { firstPage, resolveSitePage } from '@nibleaf/shared/site-route';
import { describe, expect, it } from 'vitest';
import { flatten as editorTreeRows } from '@/components/editor/sortable-page-tree';
import type { PageNode } from '@/hooks/api/types';
import { previewHomeId, previewNavTree } from './preview-nav';

type Fixture = Pick<PageNode, 'id' | 'parentId' | 'kind' | 'title' | 'position'> &
  Partial<Pick<PageNode, 'hidden' | 'config' | 'translationKey' | 'languageId'>>;

const EN = { code: 'en', defaultCode: 'en' };
const AR = { code: 'ar', defaultCode: 'en' };

/** One draft page, as the dashboard API returns it. */
const draft = ({ hidden = false, ...page }: Fixture): PageNode => ({
  languageId: 'lang-en',
  slug: page.id,
  path: page.id,
  icon: null,
  description: null,
  updatedAt: '2026-11-13T00:00:00.000Z',
  hidden,
  ...page,
});

/** The same page as a publish snapshots it for the live reader. */
const published = (page: PageNode): SnapshotPage => ({
  ...page,
  config: page.config ?? null,
  versionId: 'version-main',
  languageCode: 'en',
  content: '',
  translationKey: null,
});

/** Every entry in nav order, groups included, depth-first. */
const navOrder = (nodes: readonly NavNode[]): string[] => nodes.flatMap((node) => [node.id, ...navOrder(node.children)]);

/** The editor tree's rows in order, without what readers never see. */
const editorOrder = (pages: PageNode[]) => {
  const hidden = new Set(pages.filter((page) => page.hidden).map((page) => page.id));
  const rows = editorTreeRows(pages).filter((row) => !hidden.has(row.id));
  // A hidden page hides its subtree from readers too.
  const parents = new Map(pages.map((page) => [page.id, page.parentId]));
  const underHidden = (id: string | null): boolean => (id ? hidden.has(id) || underHidden(parents.get(id) ?? null) : false);
  return rows.filter((row) => !underHidden(row.parentId)).map((row) => row.id);
};

// The starter layout from `createStarterProject` (@nibleaf/auth), out of order on purpose.
const starter = [
  draft({ id: 'faq', kind: 'PAGE', title: 'FAQ', parentId: null, position: 4 }),
  draft({ id: 'api', kind: 'GROUP', title: 'API reference', parentId: null, position: 3 }),
  draft({ id: 'widget', kind: 'PAGE', title: 'Create a widget', parentId: 'api', position: 1 }),
  draft({ id: 'auth', kind: 'PAGE', title: 'Authentication', parentId: 'api', position: 0 }),
  draft({ id: 'tour', kind: 'PAGE', title: 'Components tour', parentId: null, position: 2 }),
  draft({ id: 'install', kind: 'PAGE', title: 'Installation', parentId: null, position: 1 }),
  draft({ id: 'start', kind: 'PAGE', title: 'Getting started', parentId: null, position: 0 }),
];

// Groups and pages interleaved at every level, nested groups, subpages, and a hidden branch.
const mixed = [
  draft({ id: 'intro', kind: 'PAGE', title: 'Intro', parentId: null, position: 0 }),
  draft({ id: 'guides', kind: 'GROUP', title: 'Guides', parentId: null, position: 1 }),
  draft({ id: 'g-advanced', kind: 'GROUP', title: 'Advanced', parentId: 'guides', position: 0 }),
  draft({ id: 'g-adv-1', kind: 'PAGE', title: 'Tuning', parentId: 'g-advanced', position: 0 }),
  draft({ id: 'g-basic', kind: 'PAGE', title: 'Basics', parentId: 'guides', position: 1 }),
  draft({ id: 'g-basic-sub', kind: 'PAGE', title: 'Basics, part 2', parentId: 'g-basic', position: 0 }),
  draft({ id: 'between', kind: 'PAGE', title: 'Between', parentId: null, position: 2 }),
  draft({ id: 'secret', kind: 'PAGE', title: 'Secret', parentId: null, position: 3, hidden: true }),
  draft({ id: 'secret-child', kind: 'PAGE', title: 'Under secret', parentId: 'secret', position: 0 }),
  draft({ id: 'ref', kind: 'GROUP', title: 'Reference', parentId: null, position: 4 }),
  draft({ id: 'ref-b', kind: 'PAGE', title: 'B', parentId: 'ref', position: 1 }),
  draft({ id: 'ref-a', kind: 'PAGE', title: 'A', parentId: 'ref', position: 0 }),
  draft({ id: 'outro', kind: 'PAGE', title: 'Outro', parentId: null, position: 5 }),
];

describe('one navigation order (P1-DASH-002, P1-DASH-003)', () => {
  it.each([
    ['the starter site', starter],
    ['a mixed groups-and-pages tree', mixed],
  ])('gives the editor tree, the draft preview and the live reader the same order for %s', (_name, pages) => {
    const editor = editorOrder(pages);
    const preview = navOrder(previewNavTree(pages, 'en'));
    const reader = navOrder(buildNavTree(pages.map(published)));
    expect(preview).toEqual(editor);
    expect(reader).toEqual(editor);
  });

  it('lists the starter site as the author arranged it and opens on its first page, like the live site', () => {
    const tree = previewNavTree(starter, 'en');
    expect(tree.map((node) => node.title)).toEqual(['Getting started', 'Installation', 'Components tour', 'API reference', 'FAQ']);
    expect(previewHomeId(starter, undefined, EN)).toBe('start');
    expect(firstPage(starter.map(published))?.id).toBe('start');
  });

  it('opens on the first page inside a group when the tree starts with one', () => {
    const pages = [
      draft({ id: 'g', kind: 'GROUP', title: 'G', parentId: null, position: 0 }),
      draft({ id: 'g-nested', kind: 'GROUP', title: 'Nested', parentId: 'g', position: 0 }),
      draft({ id: 'deep', kind: 'PAGE', title: 'Deep', parentId: 'g-nested', position: 0 }),
      draft({ id: 'later', kind: 'PAGE', title: 'Later', parentId: null, position: 1 }),
    ];
    expect(previewHomeId(pages, undefined, EN)).toBe('deep');
    expect(previewHomeId(undefined, undefined, EN)).toBeUndefined();
    expect(previewHomeId(pages, undefined, undefined)).toBeUndefined();
  });

  it('keeps a draft page’s sidebar label and virtual category, as the reader does', () => {
    const tree = previewNavTree(
      [
        draft({ id: 'a', kind: 'PAGE', title: 'A very long title', parentId: null, position: 0, config: { sidebarTitle: 'Short' } }),
        draft({ id: 'b', kind: 'PAGE', title: 'B', parentId: null, position: 1, config: { category: 'Billing' } }),
      ],
      'en',
    );
    expect(tree.map((node) => [node.kind, node.title])).toEqual([
      ['PAGE', 'Short'],
      ['GROUP', 'Billing'],
    ]);
  });

  it('opens on the page with an empty address when there is one, as the reader serves the site root', () => {
    const pages = [
      draft({ id: 'first', kind: 'PAGE', title: 'First', parentId: null, position: 0 }),
      { ...draft({ id: 'root', kind: 'PAGE', title: 'Root', parentId: null, position: 1 }), path: '' },
    ];
    expect(previewHomeId(pages, undefined, EN)).toBe('root');
    // A hidden empty-address page is not the home.
    const hidden = pages.map((page) => (page.id === 'root' ? { ...page, hidden: true } : page));
    expect(previewHomeId(hidden, undefined, EN)).toBe('first');
  });

  // Sol review of #614: the preview built the tree before its language loaded,
  // and inferring categories for a large flat import threw on an empty locale.
  it('builds no tree until the previewed language is known, and never throws for a large flat import', () => {
    const flat = Array.from({ length: 30 }, (_, index) =>
      draft({ id: `p${index}`, kind: 'PAGE', title: `Guide ${index}`, parentId: null, position: index }),
    );
    expect(previewNavTree(flat, undefined)).toEqual([]);
    expect(previewNavTree(flat, 'en').length).toBeGreaterThan(0);
    expect(() => buildNavTree(flat.map((page) => ({ ...published(page), languageCode: '' })))).not.toThrow();
  });

  it('keeps virtual categories together where their first page sits, ordered by categoryOrder (not in the editor tree)', () => {
    const pages = [
      draft({ id: 'a', kind: 'PAGE', title: 'A', parentId: null, position: 0, config: { category: 'Later', categoryOrder: 2 } }),
      draft({ id: 'g', kind: 'GROUP', title: 'G', parentId: null, position: 1 }),
      draft({ id: 'g1', kind: 'PAGE', title: 'G1', parentId: 'g', position: 0 }),
      draft({ id: 'b', kind: 'PAGE', title: 'B', parentId: null, position: 2, config: { category: 'Sooner', categoryOrder: 1 } }),
    ];
    const preview = previewNavTree(pages, 'en');
    expect(preview.map((node) => node.title)).toEqual(['Sooner', 'Later', 'G']);
    expect(navOrder(preview)).toEqual(navOrder(buildNavTree(pages.map(published))));
  });

  it('labels an untitled draft in the previewed language', () => {
    const tree = previewNavTree([draft({ id: 'u', kind: 'PAGE', title: '', parentId: null, position: 0 })], 'ar');
    expect(tree[0]?.title).toBe('صفحة بدون عنوان');
  });
});

/** English and Arabic drafts as one published snapshot, for the reader's resolver. */
const readerSnapshot = (en: readonly PageNode[], ar: readonly PageNode[], arabicEnabled = true): SiteSnapshot => ({
  project: {
    id: 'site',
    name: 'Fictional docs',
    slug: 'fictional-docs',
    description: null,
    icon: null,
    config: null,
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: arabicEnabled, config: null },
    ],
    versions: [{ id: 'version-main', name: 'main', slug: 'main', isDefault: true }],
  },
  pages: [
    ...en.map((page) => ({ ...published(page), translationKey: page.translationKey ?? null })),
    ...ar.map((page) => ({ ...published(page), languageCode: 'ar', translationKey: page.translationKey ?? null })),
  ],
  generatedAt: '2026-11-17T00:00:00.000Z',
});

/** The page the reader serves at the Arabic site root, when it is an Arabic page. */
const readerArabicHome = (en: readonly PageNode[], ar: readonly PageNode[]) => {
  const home = resolveSitePage(readerSnapshot(en, ar), '', 'ar')?.page;
  return home?.languageCode === 'ar' ? home.id : undefined;
};

describe('the preview home of a translated language (#623)', () => {
  const en = [
    draft({ id: 'en-home', kind: 'PAGE', title: 'Welcome', parentId: null, position: 0, translationKey: 'home' }),
    draft({ id: 'en-install', kind: 'PAGE', title: 'Install', parentId: null, position: 1, translationKey: 'install' }),
  ];
  const ar = [
    draft({ id: 'ar-install', kind: 'PAGE', title: 'التثبيت', parentId: null, position: 0, translationKey: 'install' }),
    draft({ id: 'ar-home', kind: 'PAGE', title: 'مرحبا', parentId: null, position: 1, translationKey: 'home' }),
  ];

  it('opens on the translation of the default home, like the reader, not the first page', () => {
    expect(readerArabicHome(en, ar)).toBe('ar-home');
    expect(previewHomeId(ar, en, AR)).toBe('ar-home');
    expect(firstPage(ar.map(published))?.id).toBe('ar-install');
  });

  it('opens on its first page while the default language’s drafts are unknown or empty', () => {
    expect(previewHomeId(ar, undefined, AR)).toBe('ar-install');
    expect(previewHomeId(ar, [], AR)).toBe('ar-install');
  });

  it('opens on nothing when the language has no pages (the reader then serves the default language)', () => {
    expect(resolveSitePage(readerSnapshot(en, []), '', 'ar')?.page.id).toBe('en-home');
    expect(previewHomeId([], en, AR)).toBeUndefined();
  });

  it('still previews a disabled language’s home, which the reader serves only once it is enabled', () => {
    expect(resolveSitePage(readerSnapshot(en, ar, false), '', 'ar')?.page.id).toBe('en-home');
    expect(previewHomeId(ar, en, AR)).toBe('ar-home');
  });

  // A seeded sweep of small sites: keys, shared addresses, empty addresses,
  // hidden pages, groups and nesting in both languages.
  it('matches the reader’s Arabic site root on generated draft sites', () => {
    let seed = 623;
    const random = (n: number) => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % n;
    };
    const site = (prefix: string, languageId: string) => {
      const pages: PageNode[] = [];
      const count = random(6);
      for (let index = 0; index < count; index++) {
        const parent = pages.length && random(3) === 0 ? pages[random(pages.length)] : undefined;
        const paths = ['', 'start', 'install', 'faq', `${prefix}-${index}`];
        pages.push({
          ...draft({
            id: `${prefix}-${index}`,
            kind: random(4) === 0 ? 'GROUP' : 'PAGE',
            title: `${prefix} ${index}`,
            parentId: parent?.id ?? null,
            position: random(4),
            hidden: random(5) === 0,
            translationKey: random(2) === 0 ? (['home', 'install', 'faq'][random(3)] ?? null) : null,
            languageId,
          }),
          path: paths[random(paths.length)] ?? '',
        });
      }
      return pages;
    };
    let translated = 0;
    for (let run = 0; run < 400; run++) {
      const enSite = site('en', 'lang-en');
      const arSite = site('ar', 'lang-ar');
      const expected = readerArabicHome(enSite, arSite);
      expect(previewHomeId(arSite, enSite, AR), `run ${run}`).toBe(expected);
      if (expected && expected !== firstPage(arSite.map(published), 'ar')?.id) translated++;
    }
    // The sweep reaches homes other than the first page in nav order.
    expect(translated).toBeGreaterThan(20);
  });
});
