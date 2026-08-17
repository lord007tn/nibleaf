import type { SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { filterPagesForReader } from './reader-scope';

const page = (id: string, parentId: string | null, kind: 'PAGE' | 'GROUP' = 'PAGE') => ({ id, parentId, kind }) as SnapshotPage;
const pages = [page('group', null, 'GROUP'), page('allowed', 'group'), page('sibling', 'group'), page('other', null)];

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
});
