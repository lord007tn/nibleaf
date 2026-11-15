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

  // The dashboard's Navbar form sends a language's FULL navbar override (the
  // CTA label and lists it sets), or `navbar: null` to fall back to the project's.
  describe("the Navbar form's language saves", () => {
    const OTHERS = { footer: { copyright: '© أكمي' }, banner: { message: 'إعلان' }, search: { placeholder: 'ابحث' }, seo: { metaTitle: 'توثيق' } };
    const save = (config: unknown) => updateLanguage('project', 'ar', updateLanguageBody.parse(JSON.parse(JSON.stringify({ config }))));

    it('replaces the stored override whole and keeps the SEO and every other chrome section', async () => {
      current.config = { ...structuredClone(OTHERS), navbar: { ctaLabel: 'ابدأ', tabs: [{ label: 'أدلة', href: '/guides' }] } };
      await save({ navbar: { links: [{ label: 'التوثيق', href: '/docs', external: false }] } });
      expect(current.config).toStrictEqual({ ...OTHERS, navbar: { links: [{ label: 'التوثيق', href: '/docs', external: false }] } });
    });

    it('navbar: null drops the override only', async () => {
      current.config = { ...structuredClone(OTHERS), navbar: { ctaLabel: 'ابدأ' } };
      await save({ navbar: null });
      expect(current.config).toStrictEqual(OTHERS);
    });

    it('refuses a global field in a language override', () => {
      expect(updateLanguageBody.safeParse({ config: { navbar: { ctaUrl: '/x' } } }).success).toBe(false);
      expect(updateLanguageBody.safeParse({ config: { navbar: { showSearch: false } } }).success).toBe(false);
    });
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
