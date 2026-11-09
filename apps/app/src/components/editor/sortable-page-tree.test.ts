import { describe, expect, it } from 'vitest';
import type { PageNode } from '@/hooks/api/types';
import { buildMove, flatten, getProjection, inlineDragOffset, languageMarkerId, rowName, type TreeItem } from './sortable-page-tree';

const node = (id: string, position: number, parentId: string | null = null, languageId = 'ar'): PageNode => ({
  id,
  parentId,
  languageId,
  kind: 'PAGE',
  title: id,
  slug: id,
  path: id,
  icon: null,
  description: null,
  position,
  hidden: false,
  updatedAt: '2026-11-06T00:00:00Z',
});

const marker = (languageId: string): TreeItem => ({ id: languageMarkerId(languageId), languageId, marker: true });

describe('drag-to-nest direction (W13)', () => {
  const items = flatten([node('first', 0), node('second', 1)]);

  it('nests when dragging towards the inline end in an LTR dashboard (right)', () => {
    expect(getProjection(items, 'second', 'second', inlineDragOffset(20, 'ltr'), 16)).toEqual({ depth: 1, parentId: 'first', languageId: 'ar' });
    expect(getProjection(items, 'second', 'second', inlineDragOffset(-20, 'ltr'), 16)).toEqual({ depth: 0, parentId: null, languageId: 'ar' });
  });

  it('nests when dragging towards the inline end in an RTL dashboard (left)', () => {
    expect(getProjection(items, 'second', 'second', inlineDragOffset(-20, 'rtl'), 16)).toEqual({ depth: 1, parentId: 'first', languageId: 'ar' });
    expect(getProjection(items, 'second', 'second', inlineDragOffset(20, 'rtl'), 16)).toEqual({ depth: 0, parentId: null, languageId: 'ar' });
  });

  it('un-nests a child when dragging towards the inline start in RTL (right)', () => {
    const nested = flatten([node('parent', 0), node('child', 0, 'parent')]);
    expect(getProjection(nested, 'child', 'child', inlineDragOffset(20, 'rtl'), 16)).toEqual({ depth: 0, parentId: null, languageId: 'ar' });
  });
});

describe('moving between language sections', () => {
  // English: guide > intro, faq. Arabic: adlh.
  const english = flatten([node('guide', 0, null, 'en'), node('intro', 0, 'guide', 'en'), node('faq', 1, null, 'en')]);
  const arabic = flatten([node('adlh', 0, null, 'ar')]);
  const list: TreeItem[] = [marker('en'), ...english, marker('ar'), ...arabic];

  it('lands in the language whose section it is dragged into', () => {
    // faq dragged down over the Arabic header: right under it, at the top level.
    expect(getProjection(list, 'faq', languageMarkerId('ar'), 0, 16)).toEqual({ depth: 0, parentId: null, languageId: 'ar' });
    // ...over the Arabic page and to the inline end: nested inside it.
    expect(getProjection(list, 'faq', 'adlh', 16, 16)).toEqual({ depth: 1, parentId: 'adlh', languageId: 'ar' });
  });

  it('keeps an Arabic page dragged up over the Arabic header in English, at the end', () => {
    expect(getProjection(list, 'adlh', languageMarkerId('ar'), 0, 16)).toEqual({ depth: 0, parentId: null, languageId: 'en' });
  });

  it('moves the dragged page and its whole subtree into the target language', () => {
    const projection = getProjection(list, 'guide', 'adlh', 16, 16);
    expect(projection).toEqual({ depth: 1, parentId: 'adlh', languageId: 'ar' });
    const moves = buildMove(list, 'guide', 'adlh', projection);
    expect(moves).toEqual(
      expect.arrayContaining([
        { id: 'guide', parentId: 'adlh', position: 0, languageId: 'ar' },
        { id: 'intro', parentId: 'guide', position: 0, languageId: 'ar' },
        { id: 'faq', parentId: null, position: 0, languageId: 'en' },
        { id: 'adlh', parentId: null, position: 0, languageId: 'ar' },
      ]),
    );
    expect(moves).toHaveLength(4);
  });

  it('only sends the languages a move touches', () => {
    const withFrench: TreeItem[] = [...list, marker('fr'), ...flatten([node('bonjour', 0, null, 'fr')])];
    const projection = getProjection(withFrench, 'faq', 'guide', 0, 16);
    const moves = buildMove(withFrench, 'faq', 'guide', projection);
    expect(moves.map((move) => move.id).sort()).toEqual(['faq', 'guide', 'intro']);
    expect(moves.find((move) => move.id === 'faq')).toEqual({ id: 'faq', parentId: null, position: 0, languageId: 'en' });
    expect(moves.find((move) => move.id === 'guide')?.position).toBe(1);
  });
});

describe('row rename target', () => {
  it('renames the sidebar title when the row shows one, else the page title', () => {
    expect(rowName({ title: 'Getting started with billing', config: { sidebarTitle: ' Billing ' } })).toEqual({
      label: 'Billing',
      field: 'sidebarTitle',
    });
    expect(rowName({ title: 'Billing', config: { sidebarTitle: '  ' } })).toEqual({ label: 'Billing', field: 'title' });
    expect(rowName({ title: 'Billing', config: null })).toEqual({ label: 'Billing', field: 'title' });
  });
});
