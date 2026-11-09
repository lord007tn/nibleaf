import { describe, expect, it } from 'vitest';
import { applyPageReorder, isPageListKey } from './page-cache';

describe('applyPageReorder (optimistic tree order)', () => {
  const pages = [
    { id: 'a', parentId: null, position: 0 },
    { id: 'b', parentId: null, position: 1 },
    { id: 'c', parentId: null, position: 2 },
  ];

  it('applies the new parent and position of every moved page', () => {
    const next = applyPageReorder(pages, [
      { id: 'a', parentId: null, position: 0 },
      { id: 'c', parentId: null, position: 1 },
      { id: 'b', parentId: 'a', position: 0 },
    ]);
    expect(next).toEqual([
      { id: 'a', parentId: null, position: 0 },
      { id: 'b', parentId: 'a', position: 0 },
      { id: 'c', parentId: null, position: 1 },
    ]);
  });

  it('keeps untouched pages as the same objects', () => {
    const next = applyPageReorder(pages, [{ id: 'b', parentId: null, position: 5 }]);
    expect(next[0]).toBe(pages[0]);
    expect(next[1]).not.toBe(pages[1]);
    expect(applyPageReorder(pages, [])).toBe(pages);
  });

  it('moves a page into another language when the request says so', () => {
    const multilingual = [
      { id: 'a', parentId: null, position: 0, languageId: 'en' },
      { id: 'b', parentId: 'a', position: 0, languageId: 'en' },
    ];
    const next = applyPageReorder(multilingual, [
      { id: 'a', parentId: null, position: 3, languageId: 'ar' },
      { id: 'b', parentId: 'a', position: 0, languageId: 'ar' },
    ]);
    expect(next.map((page) => page.languageId)).toEqual(['ar', 'ar']);
    expect(next[0]?.position).toBe(3);
    expect(applyPageReorder(multilingual, [{ id: 'a', parentId: null, position: 0, languageId: 'en' }])[0]).toBe(multilingual[0]);
  });

  it('tells page lists apart from page details in the query cache', () => {
    expect(isPageListKey(['pages', 'project', null, 'branch'])).toBe(true);
    expect(isPageListKey(['pages', 'project', 'page-id'])).toBe(false);
  });
});
