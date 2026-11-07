import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transactionLock } from './transaction-lock.test-helper';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), transaction: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    language: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

import { updateLanguage } from './languages';

describe('language write serialization', () => {
  let current: { id: string; projectId: string; isDefault: boolean; enabled: boolean; config: object };
  beforeEach(() => {
    vi.resetAllMocks();
    current = { id: 'ar', projectId: 'project', isDefault: false, enabled: true, config: {} };
    const read = async () => structuredClone(current);
    mocks.findFirst.mockImplementation(read);
    mocks.findUnique.mockImplementation(read);
    mocks.update.mockImplementation(async ({ data }) => {
      current = { ...current, ...data };
      return structuredClone(current);
    });
    const transaction = transactionLock();
    mocks.transaction.mockImplementation((work) =>
      transaction(work, {
        language: { findUnique: mocks.findUnique, findFirst: mocks.findFirst, update: mocks.update, updateMany: mocks.updateMany },
        projectTranslation: { findUnique: async () => null },
      }),
    );
  });

  it('retains simultaneous banner and SEO edits', async () => {
    await Promise.all([
      updateLanguage('project', 'ar', { config: { banner: { message: 'Arabic announcement' } } }),
      updateLanguage('project', 'ar', { config: { seo: { metaTitle: 'Arabic documentation' } } }),
    ]);
    expect(current.config).toEqual({ banner: { message: 'Arabic announcement' }, seo: { metaTitle: 'Arabic documentation' } });
  });

  it('checks default-language protection against the locked row', async () => {
    mocks.findFirst.mockResolvedValueOnce(structuredClone(current));
    mocks.findUnique.mockResolvedValueOnce({ ...current, isDefault: true });
    await expect(updateLanguage('project', 'ar', { enabled: false })).rejects.toMatchObject({ code: 'database:conflict' });
    expect(current.enabled).toBe(true);
  });
});
