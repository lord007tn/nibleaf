import { MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stored: '',
  page: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  createPage: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({ prisma: { page: mocks.page }, Prisma: {} }));
vi.mock('../branches', () => ({ getDefaultBranch: vi.fn() }));
vi.mock('../languages', () => ({ getDefaultLanguage: vi.fn() }));
vi.mock('../pages', async () => ({
  createPage: mocks.createPage,
  // The real check: re-imports must follow the same rule as editor saves.
  assertPageContentFits: (await vi.importActual<typeof import('../pages')>('../pages')).assertPageContentFits,
}));

import { upsertLeafPage } from './persistence';

const target = { projectId: 'project-1', branchId: 'branch-1', languageId: 'language-1' };
const imported = (content: string) => ({ parentId: null, slug: 'guide', title: 'Guide', content });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.page.findFirst.mockResolvedValue({ id: 'page-1', config: null });
  mocks.page.findUniqueOrThrow.mockImplementation(async () => ({ content: mocks.stored }));
  mocks.page.update.mockResolvedValue({});
});

describe('re-importing an existing page', () => {
  it('updates under the cap without reading the stored body', async () => {
    await expect(upsertLeafPage(target, imported('x'.repeat(MAX_PAGE_CONTENT_BYTES)))).resolves.toBe('updated');
    expect(mocks.page.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.page.update).toHaveBeenCalledOnce();
  });

  it('refuses content over the cap that grows the stored page', async () => {
    mocks.stored = 'small';
    await expect(upsertLeafPage(target, imported('x'.repeat(MAX_PAGE_CONTENT_BYTES + 1)))).rejects.toMatchObject({
      status: 413,
      code: 'page:too_large',
      details: { bytes: MAX_PAGE_CONTENT_BYTES + 1, limit: MAX_PAGE_CONTENT_BYTES },
    });
    expect(mocks.page.update).not.toHaveBeenCalled();
  });

  it('keeps updating a page already over the cap when the import does not grow it', async () => {
    mocks.stored = 'x'.repeat(3 * 1024 * 1024);
    await expect(upsertLeafPage(target, imported('x'.repeat(2.5 * 1024 * 1024)))).resolves.toBe('updated');
    expect(mocks.page.update).toHaveBeenCalledOnce();
  });
});
