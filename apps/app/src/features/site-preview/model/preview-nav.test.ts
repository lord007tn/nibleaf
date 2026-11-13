import { buildNavTree, type NavNode, type SnapshotPage } from '@nibleaf/shared/site';
import { firstPage } from '@nibleaf/shared/site-route';
import { describe, expect, it } from 'vitest';
import { flatten as editorTreeRows } from '@/components/editor/sortable-page-tree';
import type { PageNode } from '@/hooks/api/types';
import { previewHomeId, previewNavTree } from './preview-nav';

type Fixture = Pick<PageNode, 'id' | 'parentId' | 'kind' | 'title' | 'position'> & Partial<Pick<PageNode, 'hidden' | 'config'>>;

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
    expect(previewHomeId(tree)).toBe('start');
    expect(firstPage(starter.map(published))?.id).toBe('start');
  });

  it('opens on the first page inside a group when the tree starts with one', () => {
    const tree = previewNavTree(
      [
        draft({ id: 'g', kind: 'GROUP', title: 'G', parentId: null, position: 0 }),
        draft({ id: 'g-nested', kind: 'GROUP', title: 'Nested', parentId: 'g', position: 0 }),
        draft({ id: 'deep', kind: 'PAGE', title: 'Deep', parentId: 'g-nested', position: 0 }),
        draft({ id: 'later', kind: 'PAGE', title: 'Later', parentId: null, position: 1 }),
      ],
      'en',
    );
    expect(previewHomeId(tree)).toBe('deep');
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

  it('labels an untitled draft in the previewed language', () => {
    const tree = previewNavTree([draft({ id: 'u', kind: 'PAGE', title: '', parentId: null, position: 0 })], 'ar');
    expect(tree[0]?.title).toBe('صفحة بدون عنوان');
  });
});
