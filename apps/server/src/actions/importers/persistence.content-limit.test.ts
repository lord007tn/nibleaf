import { MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  /** The body stored when the row lock is taken. */
  locked: '',
  events: [] as string[],
  page: { findFirst: vi.fn(), update: vi.fn() },
  tx: { $queryRaw: vi.fn(), page: { update: vi.fn() } },
  transaction: vi.fn(),
  createPage: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({ prisma: { page: mocks.page, $transaction: mocks.transaction }, Prisma: {} }));
vi.mock('../branches', () => ({ getDefaultBranch: vi.fn() }));
vi.mock('../languages', () => ({ getDefaultLanguage: vi.fn() }));
vi.mock('../pages', async () => ({
  createPage: mocks.createPage,
  // The real check: re-imports must follow the same rule as editor saves.
  assertPageContentFits: (await vi.importActual<typeof import('../pages')>('../pages')).assertPageContentFits,
}));

import { upsertLeafPage } from './persistence';

const MiB = 1024 * 1024;
const target = { projectId: 'project-1', branchId: 'branch-1', languageId: 'language-1' };
const imported = (content: string) => ({ parentId: null, slug: 'guide', title: 'Guide', content });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events = [];
  mocks.page.findFirst.mockResolvedValue({ id: 'page-1', config: null });
  mocks.page.update.mockResolvedValue({});
  mocks.tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
    mocks.events.push(`lock:${sql.join('?').includes('FOR NO KEY UPDATE')}`);
    return [{ content: mocks.locked }];
  });
  mocks.tx.page.update.mockImplementation(async () => mocks.events.push('tx-write'));
  mocks.transaction.mockImplementation(async (work: (tx: typeof mocks.tx) => Promise<unknown>) => {
    mocks.events.push('begin');
    const result = await work(mocks.tx);
    mocks.events.push('commit');
    return result;
  });
});

describe('re-importing an existing page', () => {
  it('updates at or under the cap without reading the stored body', async () => {
    await expect(upsertLeafPage(target, imported('x'.repeat(MAX_PAGE_CONTENT_BYTES)))).resolves.toBe('updated');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.page.update).toHaveBeenCalledOnce();
  });

  it('refuses content over the cap that grows the locked stored page', async () => {
    mocks.locked = 'small';
    await expect(upsertLeafPage(target, imported('x'.repeat(MAX_PAGE_CONTENT_BYTES + 1)))).rejects.toMatchObject({
      status: 413,
      code: 'page:too_large',
      details: { bytes: MAX_PAGE_CONTENT_BYTES + 1, limit: MAX_PAGE_CONTENT_BYTES },
    });
    expect(mocks.events).toEqual(['begin', 'lock:true']);
    expect(mocks.page.update).not.toHaveBeenCalled();
  });

  it('locks, compares and writes in one transaction when the import does not grow the page', async () => {
    mocks.locked = 'x'.repeat(3 * MiB);
    await expect(upsertLeafPage(target, imported('x'.repeat(2.5 * MiB)))).resolves.toBe('updated');
    expect(mocks.events).toEqual(['begin', 'lock:true', 'tx-write', 'commit']);
    expect(mocks.page.update).not.toHaveBeenCalled();
  });

  it('compares with the body read under the lock, not an earlier read', async () => {
    // A concurrent edit shrank the page to 1 MiB before the lock: the 2.5 MiB
    // import now grows it and is refused.
    mocks.locked = 'x'.repeat(MiB);
    await expect(upsertLeafPage(target, imported('x'.repeat(2.5 * MiB)))).rejects.toMatchObject({ code: 'page:too_large' });
    expect(mocks.tx.page.update).not.toHaveBeenCalled();
  });
});
