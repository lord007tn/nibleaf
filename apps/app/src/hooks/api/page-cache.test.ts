import { describe, expect, it } from 'vitest';
import { applyPageReorder, applyPageReorderToList, isPageListKey } from './page-cache';

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

  it('takes cached descendants along to the new language even when the request left them out', () => {
    const tree = [
      { id: 'guide', parentId: null, position: 0, languageId: 'en' },
      { id: 'late-child', parentId: 'guide', position: 0, languageId: 'en' },
      { id: 'grandchild', parentId: 'late-child', position: 0, languageId: 'en' },
      { id: 'other', parentId: null, position: 1, languageId: 'en' },
    ];
    const next = applyPageReorder(tree, [{ id: 'guide', parentId: null, position: 0, languageId: 'ar' }]);
    expect(next.map((page) => [page.id, page.languageId])).toEqual([
      ['guide', 'ar'],
      ['late-child', 'ar'],
      ['grandchild', 'ar'],
      ['other', 'en'],
    ]);
    expect(next[3]).toBe(tree[3]);
  });

  it('moves a page between language-filtered lists and leaves other languages alone', () => {
    const english = [
      { id: 'guide', parentId: null, position: 0, languageId: 'en', branchId: 'main' },
      { id: 'faq', parentId: null, position: 1, languageId: 'en', branchId: 'main' },
    ];
    const arabic = [{ id: 'adlh', parentId: null, position: 0, languageId: 'ar', branchId: 'main' }];
    const french = [{ id: 'bonjour', parentId: null, position: 0, languageId: 'fr', branchId: 'main' }];
    const items = [{ id: 'guide', parentId: null, position: 1, languageId: 'ar' }];
    const known = new Map([...english, ...arabic, ...french].map((page) => [page.id, page]));
    for (const page of applyPageReorder([...english, ...arabic], items)) known.set(page.id, page);
    expect(applyPageReorderToList(english, items, { languageId: 'en', branchId: null }, known).map((page) => page.id)).toEqual(['faq']);
    expect(applyPageReorderToList(arabic, items, { languageId: 'ar', branchId: null }, known)).toEqual([
      arabic[0],
      { id: 'guide', parentId: null, position: 1, languageId: 'ar', branchId: 'main' },
    ]);
    expect(applyPageReorderToList(french, items, { languageId: 'fr', branchId: null }, known)).toBe(french);
    // Another docs version's list never takes in this branch's page.
    const otherVersion = [{ id: 'v2-adlh', parentId: null, position: 0, languageId: 'ar', branchId: 'v2' }];
    expect(applyPageReorderToList(otherVersion, items, { languageId: 'ar', branchId: 'v2' }, known)).toBe(otherVersion);
  });

  it('tells page lists apart from page details in the query cache', () => {
    expect(isPageListKey(['pages', 'project', null, 'branch'])).toBe(true);
    expect(isPageListKey(['pages', 'project', 'page-id'])).toBe(false);
  });
});
