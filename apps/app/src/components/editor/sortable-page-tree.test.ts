import { describe, expect, it } from 'vitest';
import type { PageNode } from '@/hooks/api/types';
import { flatten, getProjection, inlineDragOffset } from './sortable-page-tree';

const node = (id: string, position: number, parentId: string | null = null): PageNode => ({
  id,
  parentId,
  languageId: 'ar',
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

describe('drag-to-nest direction (W13)', () => {
  const items = flatten([node('first', 0), node('second', 1)]);

  it('nests when dragging towards the inline end in LTR (right)', () => {
    expect(getProjection(items, 'second', 'second', inlineDragOffset(20, 'ltr'), 16)).toEqual({ depth: 1, parentId: 'first' });
    expect(getProjection(items, 'second', 'second', inlineDragOffset(-20, 'ltr'), 16)).toEqual({ depth: 0, parentId: null });
  });

  it('nests when dragging towards the inline end in RTL (left)', () => {
    expect(getProjection(items, 'second', 'second', inlineDragOffset(-20, 'rtl'), 16)).toEqual({ depth: 1, parentId: 'first' });
    expect(getProjection(items, 'second', 'second', inlineDragOffset(20, 'rtl'), 16)).toEqual({ depth: 0, parentId: null });
  });

  it('un-nests a child when dragging towards the inline start in RTL (right)', () => {
    const nested = flatten([node('parent', 0), node('child', 0, 'parent')]);
    expect(getProjection(nested, 'child', 'child', inlineDragOffset(20, 'rtl'), 16)).toEqual({ depth: 0, parentId: null });
  });
});
