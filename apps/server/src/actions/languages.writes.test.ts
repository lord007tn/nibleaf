import { updateLanguageBody } from '@nibleaf/validators';
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
  let current: { id: string; projectId: string; isDefault: boolean; enabled: boolean; config: object | null };
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

  // The dashboard's SEO form sends the language's SEO as JSON: all four values
  // with cleared text as '', or `config: null` when nothing is left to override.
  describe("the SEO form's language saves", () => {
    const CHROME = { navbar: { ctaLabel: 'ابدأ' }, footer: { copyright: '© أكمي' }, banner: { message: 'إعلان' }, search: { placeholder: 'ابحث' } };
    const SEO = { metaTitle: 'توثيق', metaDescription: 'كل شيء', socialImage: '/og/ar.png', allowIndex: false };
    const save = (config: unknown) => updateLanguage('project', 'ar', updateLanguageBody.parse(JSON.parse(JSON.stringify({ config }))));

    it('config: null clears the SEO and keeps every chrome section; the translation is not touched', async () => {
      current.config = { ...structuredClone(CHROME), seo: SEO };
      // The transaction offers no projectTranslation writes: touching the translation would throw.
      await save(null);
      expect(current.config).toStrictEqual(CHROME);
    });

    it('config: null on a language with only SEO stores no config at all', async () => {
      current.config = { seo: SEO };
      await save(null);
      expect(current.config).toBeNull();
    });

    it('stores each cleared text as "" and the index choice, keeping the chrome', async () => {
      current.config = { ...structuredClone(CHROME), seo: SEO };
      await save({ seo: { metaTitle: '', metaDescription: '', socialImage: '/og/ar.png', allowIndex: true } });
      expect(current.config).toStrictEqual({ ...CHROME, seo: { metaTitle: '', metaDescription: '', socialImage: '/og/ar.png', allowIndex: true } });
    });
  });
});
