import { describe, expect, it } from 'vitest';
import type { PageNode } from '@/hooks/api';
import { filterPageIds, normalizePageSearch, pageMatchRanges } from './page-tree-utils';

describe('page tree filtering', () => {
  it('folds case, accents, Arabic alef forms, marks, tatweel and taa marbuta', () => {
    expect(normalizePageSearch('ÉCOLE أَإآٱ ـمدرسة')).toBe('ecole اااا مدرسه');
    expect(pageMatchRanges('مَدرَسـة', 'مدرسه')).toEqual([[0, 8]]);
    expect(pageMatchRanges('Café guide', 'CAFE')).toEqual([[0, 4]]);
    expect(pageMatchRanges('🚀 Café', 'cafe')).toEqual([[3, 7]]);
  });
  it('keeps all ancestors of a title or address match and excludes unrelated children', () => {
    const pages = [
      { id: 'root', parentId: null, title: 'Root', slug: 'root', path: 'root' },
      { id: 'group', parentId: 'root', title: 'Group', slug: 'group', path: 'root/group' },
      { id: 'match', parentId: 'group', title: 'إعدادات المدرسة', slug: 'config', path: 'root/group/config' },
      { id: 'other', parentId: 'group', title: 'Other', slug: 'other', path: 'root/group/other' },
    ] as PageNode[];
    expect([...filterPageIds(pages, 'اعدادات المدرسه')]).toEqual(['match', 'group', 'root']);
    expect([...filterPageIds(pages, 'CONFIG')]).toEqual(['match', 'group', 'root']);
    expect([...filterPageIds(pages, 'missing')]).toEqual([]);
  });
});
