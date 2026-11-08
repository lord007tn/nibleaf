import type { SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { filterPagesForReader } from './reader-scope';

const page = (id: string, parentId: string | null, kind: 'PAGE' | 'GROUP' = 'PAGE') => ({ id, parentId, kind }) as SnapshotPage;
const pages = [page('group', null, 'GROUP'), page('allowed', 'group'), page('sibling', 'group'), page('other', null)];

const fullPage = (over: Partial<SnapshotPage> & Pick<SnapshotPage, 'id'>): SnapshotPage => ({
  parentId: null,
  versionId: 'version-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: over.id,
  slug: over.id,
  path: over.id,
  icon: null,
  description: null,
  content: '',
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  ...over,
});

describe('filterPagesForReader', () => {
  it('returns the original snapshot for a site-wide grant', () => {
    expect(filterPagesForReader(pages, null)).toBe(pages);
  });

  it('keeps a granted leaf and its navigation ancestors without leaking siblings', () => {
    expect(filterPagesForReader(pages, new Set(['allowed'])).map((item) => item.id)).toEqual(['group', 'allowed']);
  });

  it('returns no content when a reader has no effective grant', () => {
    expect(filterPagesForReader(pages, new Set())).toEqual([]);
  });

  it('keeps an ungranted parent page as a navigation label only', () => {
    const parent = fullPage({
      id: 'parent',
      path: 'plan',
      title: 'Plan',
      icon: 'map',
      description: 'Parent summary',
      content: '# Parent body',
      translationKey: 'plan',
      config: { sidebarTitle: 'Plan', tag: 'New', seo: { metaDescription: 'Parent SEO', ogImage: '/api/public/assets/projects/p/assets/og.png' } },
    });
    const child = fullPage({ id: 'child', parentId: 'parent', path: 'plan/guide', content: '# Child body' });
    const [label, granted] = filterPagesForReader([parent, child], new Set(['child']));

    expect(granted).toBe(child);
    expect(label).toEqual({
      id: 'parent',
      parentId: null,
      versionId: 'version-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      languageCode: 'en',
      kind: 'GROUP',
      title: 'Plan',
      slug: 'parent',
      path: 'plan',
      icon: 'map',
      description: null,
      content: '',
      config: { sidebarTitle: 'Plan', tag: 'New' },
      translationKey: 'plan',
      position: 0,
      hidden: false,
    });
  });

  it('strips bodies from every ungranted ancestor, including groups', () => {
    const root = fullPage({ id: 'root', kind: 'GROUP', content: 'group text' });
    const middle = fullPage({ id: 'middle', parentId: 'root', content: 'middle body' });
    const leaf = fullPage({ id: 'leaf', parentId: 'middle', content: 'leaf body' });
    const result = filterPagesForReader([root, middle, leaf], new Set(['leaf']));
    expect(result.map((item) => [item.id, item.kind, item.content])).toEqual([
      ['root', 'GROUP', ''],
      ['middle', 'GROUP', ''],
      ['leaf', 'PAGE', 'leaf body'],
    ]);
  });

  it('serves a parent page body only when the parent is granted as well', () => {
    const parent = fullPage({ id: 'parent', content: 'parent body' });
    const child = fullPage({ id: 'child', parentId: 'parent', content: 'child body' });
    expect(filterPagesForReader([parent, child], new Set(['parent', 'child']))).toEqual([parent, child]);
  });
});
