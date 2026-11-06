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

  it('tells page lists apart from page details in the query cache', () => {
    expect(isPageListKey(['pages', 'project', null, 'branch'])).toBe(true);
    expect(isPageListKey(['pages', 'project', 'page-id'])).toBe(false);
  });
});
