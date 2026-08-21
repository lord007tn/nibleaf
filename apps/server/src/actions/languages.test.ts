import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  languages: vi.fn(),
  pages: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {}, JsonNull: null },
  prisma: {
    language: { findMany: database.languages },
    page: { findMany: database.pages },
  },
}));

import { listLanguagesWithCoverage } from './languages';

const language = (id: string, isDefault = false) => ({
  id,
  projectId: 'project-1',
  code: id,
  label: id,
  direction: 'LTR',
  isDefault,
  enabled: true,
  position: isDefault ? 0 : 1,
  config: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  projectTranslations: [],
});

describe('listLanguagesWithCoverage', () => {
  beforeEach(() => {
    database.languages.mockReset();
    database.pages.mockReset();
  });

  it('matches localized pages by key or same-path fallback without reusing one target', async () => {
    database.languages.mockResolvedValue([language('en', true), language('ar')]);
    database.pages.mockResolvedValue([
      { id: 'en-start', languageId: 'en', path: 'guides/start', translationKey: 'start' },
      { id: 'en-start-copy', languageId: 'en', path: 'guides/start-copy', translationKey: 'start' },
      { id: 'en-faq', languageId: 'en', path: 'faq', translationKey: null },
      { id: 'ar-start', languageId: 'ar', path: 'ar/bidaya', translationKey: 'start' },
      { id: 'ar-faq', languageId: 'ar', path: 'faq', translationKey: 'faq-localized' },
      { id: 'ar-only', languageId: 'ar', path: 'ar/only', translationKey: 'ar-only' },
    ]);

    const result = await listLanguagesWithCoverage('project-1');

    expect(result[0]?.coverage).toEqual({
      pageCount: 3,
      sourcePageCount: 3,
      matchedPages: 3,
      missingPages: 0,
      extraPages: 0,
      percentage: 100,
    });
    expect(result[1]?.coverage).toEqual({
      pageCount: 3,
      sourcePageCount: 3,
      matchedPages: 2,
      missingPages: 1,
      extraPages: 1,
      percentage: 67,
    });
  });

  it('reports an empty baseline without claiming a percentage', async () => {
    database.languages.mockResolvedValue([language('en', true), language('ar')]);
    database.pages.mockResolvedValue([{ id: 'ar-only', languageId: 'ar', path: 'only', translationKey: null }]);

    const result = await listLanguagesWithCoverage('project-1');

    expect(result.map(({ coverage }) => coverage)).toEqual([
      { pageCount: 0, sourcePageCount: 0, matchedPages: 0, missingPages: 0, extraPages: 0, percentage: null },
      { pageCount: 1, sourcePageCount: 0, matchedPages: 0, missingPages: 0, extraPages: 1, percentage: null },
    ]);
  });
});
