import { STARTER_GETTING_STARTED_CONTENT } from '@nibleaf/auth/starter-content';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; parentId: string | null; slug: string; content: string };

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  prisma: { page: { findMany: vi.fn(), deleteMany: vi.fn() } },
}));

vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma }));
vi.mock('../branches', () => ({ getDefaultBranch: vi.fn() }));
vi.mock('../languages', () => ({ getDefaultLanguage: vi.fn() }));
vi.mock('../pages', () => ({ createPage: vi.fn() }));

import { isPristineStarterPage, removeImportPlaceholders } from './persistence';

const target = { projectId: 'project-1', branchId: 'branch-1', languageId: 'language-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.prisma.page.findMany.mockImplementation(async ({ where }: { where: { parentId: null | { in: string[] }; slug?: { in: string[] } } }) =>
    mocks.rows.filter((row) =>
      where.parentId === null ? row.parentId === null && (where.slug?.in ?? []).includes(row.slug) : where.parentId.in.includes(row.parentId ?? ''),
    ),
  );
  mocks.prisma.page.deleteMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
    const before = mocks.rows.length;
    mocks.rows = mocks.rows.filter((row) => !where.id.in.includes(row.id));
    return { count: before - mocks.rows.length };
  });
});

describe('removeImportPlaceholders', () => {
  it('removes a starter page that is still exactly the template, ignoring whitespace', async () => {
    const reflowed = STARTER_GETTING_STARTED_CONTENT.replace(/\n/g, '\n\n  ');
    mocks.rows.push({ id: 'starter', parentId: null, slug: 'getting-started', content: reflowed });
    mocks.rows.push({ id: 'blank', parentId: null, slug: 'welcome', content: ' \n ' });

    await expect(removeImportPlaceholders(target)).resolves.toBe(2);
    expect(mocks.rows).toEqual([]);
  });

  it('keeps a starter page whose intro stays but which has new writing', async () => {
    mocks.rows.push({
      id: 'edited',
      parentId: null,
      slug: 'getting-started',
      content: `${STARTER_GETTING_STARTED_CONTENT}\n\nOur product syncs invoices.`,
    });
    mocks.rows.push({
      id: 'welcome',
      parentId: null,
      slug: 'welcome',
      content: 'Welcome to your new documentation site.\n\nOur product syncs invoices.',
    });

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows.map((row) => row.id)).toEqual(['edited', 'welcome']);
    expect(mocks.prisma.page.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps an untouched starter page that has an authored child page', async () => {
    mocks.rows.push({ id: 'starter', parentId: null, slug: 'getting-started', content: STARTER_GETTING_STARTED_CONTENT });
    mocks.rows.push({ id: 'child', parentId: 'starter', slug: 'billing', content: 'Our billing guide.' });

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows.map((row) => row.id)).toEqual(['starter', 'child']);
  });

  it('recognises only the exact template', () => {
    expect(isPristineStarterPage({ slug: 'getting-started', content: STARTER_GETTING_STARTED_CONTENT })).toBe(true);
    expect(isPristineStarterPage({ slug: 'getting-started', content: STARTER_GETTING_STARTED_CONTENT.replace('your product', 'Acme') })).toBe(false);
    expect(isPristineStarterPage({ slug: 'welcome', content: 'Welcome to your new documentation site.' })).toBe(false);
  });
});
