import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ raw: vi.fn(), getPage: vi.fn(), updatePage: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { $queryRaw: mocks.raw } }));
vi.mock('./pages', () => ({ getPage: mocks.getPage, updatePage: mocks.updatePage }));

import { comparePageHistory, restorePageHistory } from './page-history';

describe('page history restore boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getPage.mockResolvedValue({});
  });
  it('passes the exact reviewed revision to the normal save and returns its existing conflict unchanged', async () => {
    const expectedUpdatedAt = '2026-11-11T09:00:00.000Z';
    const conflict = { status: 409, code: 'page:revision_conflict' };
    mocks.getPage.mockResolvedValue({ id: 'page' });
    mocks.raw.mockResolvedValue([{ title: 'Older title', content: 'Older content', settings: {} }]);
    mocks.updatePage.mockRejectedValue(conflict);
    await expect(restorePageHistory('project', 'page', { source: 'revision', entryId: 'revision', expectedUpdatedAt }, 'author')).rejects.toBe(
      conflict,
    );
    expect(mocks.updatePage).toHaveBeenCalledExactlyOnceWith(
      'project',
      'page',
      { title: 'Older title', content: 'Older content', expectedUpdatedAt },
      'author',
      { restore: true },
    );
  });
  it('does not attempt a restore when the selected entry is missing or over the byte limit', async () => {
    mocks.raw.mockResolvedValue([]);
    const selection = { source: 'published' as const, entryId: 'deployment', expectedUpdatedAt: '2026-11-11T09:00:00.000Z' };
    await expect(restorePageHistory('project', 'page', selection, 'author')).rejects.toMatchObject({ status: 404 });
    mocks.raw.mockResolvedValue([{ title: 'Oversized', content: null }]);
    await expect(restorePageHistory('project', 'page', selection, 'author')).rejects.toMatchObject({ status: 400 });
    expect(mocks.updatePage).not.toHaveBeenCalled();
  });
  it('returns a capped result when SQL withheld oversized content', async () => {
    mocks.raw
      .mockResolvedValueOnce([{ title: 'Draft', content: null, updatedAt: new Date('2026-11-11T09:00:00.000Z') }])
      .mockResolvedValueOnce([{ title: 'Old', content: 'Old' }]);
    expect(await comparePageHistory('project', 'page', { source: 'revision', entryId: 'revision' })).toMatchObject({
      diff: { status: 'too-large', limit: 'bytes' },
    });
  });
});
