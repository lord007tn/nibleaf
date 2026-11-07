import { STARTER_GETTING_STARTED_CONTENT, STARTER_GETTING_STARTED_ICON, STARTER_GETTING_STARTED_TITLE } from '@nibleaf/auth/starter-content';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  icon: string | null;
  description: string | null;
  hidden: boolean;
  config: unknown;
  translationKey: string | null;
  content: string;
};
type Where = { id?: { in: string[] }; parentId?: null | { in: string[] }; slug?: { in: string[] } };

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  /** Runs when the cleanup takes each lock, to simulate a writer that commits just before. */
  onLock: [] as Array<(sql: string) => void>,
  prisma: { page: { findMany: vi.fn(), deleteMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() },
}));

vi.mock('@nibleaf/database', () => ({ prisma: mocks.prisma, Prisma: { join: (values: unknown[]) => values } }));
vi.mock('../branches', () => ({ getDefaultBranch: vi.fn() }));
vi.mock('../languages', () => ({ getDefaultLanguage: vi.fn() }));
vi.mock('../pages', () => ({ createPage: vi.fn() }));

import { isPristineStarterPage, removeImportPlaceholders } from './persistence';

const target = { projectId: 'project-1', branchId: 'branch-1', languageId: 'language-1' };
const starter = (fields: Partial<Row> = {}): Row => ({
  id: 'starter',
  parentId: null,
  slug: 'getting-started',
  title: STARTER_GETTING_STARTED_TITLE,
  icon: STARTER_GETTING_STARTED_ICON,
  description: null,
  hidden: false,
  config: null,
  translationKey: null,
  content: STARTER_GETTING_STARTED_CONTENT,
  ...fields,
});
const blankWelcome = (fields: Partial<Row> = {}): Row =>
  starter({ id: 'welcome', slug: 'welcome', title: 'Welcome', icon: null, content: '', ...fields });
const locks = () => mocks.prisma.$queryRaw.mock.calls.map(([sql]) => (sql as string[]).join('?'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.onLock = [];
  mocks.prisma.page.findMany.mockImplementation(async ({ where }: { where: Where }) =>
    mocks.rows
      .filter((row) => {
        if (where.id && !where.id.in.includes(row.id)) return false;
        if (where.slug && !where.slug.in.includes(row.slug)) return false;
        if (where.parentId === null) return row.parentId === null;
        if (where.parentId) return where.parentId.in.includes(row.parentId ?? '');
        return true;
      })
      .map((row) => ({ ...row })),
  );
  mocks.prisma.page.deleteMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
    const before = mocks.rows.length;
    mocks.rows = mocks.rows.filter((row) => !where.id.in.includes(row.id));
    return { count: before - mocks.rows.length };
  });
  mocks.prisma.$queryRaw.mockImplementation(async (sql: string[]) => {
    mocks.onLock.shift()?.(sql.join('?'));
    return [];
  });
  mocks.prisma.$transaction.mockImplementation(async (run: (tx: typeof mocks.prisma) => Promise<unknown>) => run(mocks.prisma));
});

describe('removeImportPlaceholders', () => {
  it('removes a starter page that is still exactly as sign-up made it, ignoring whitespace', async () => {
    mocks.rows.push(starter({ content: STARTER_GETTING_STARTED_CONTENT.replace(/\n/g, '\n\n  ') }));
    mocks.rows.push(blankWelcome({ content: ' \n ' }));

    await expect(removeImportPlaceholders(target)).resolves.toBe(2);
    expect(mocks.rows).toEqual([]);
    // Project lock first, then the candidate rows in ascending id order.
    expect(locks()[0]).toContain('FROM "project"');
    expect(locks()[0]).toContain('FOR NO KEY UPDATE');
    expect(locks()[1]).toContain('ORDER BY "id" FOR UPDATE');
    expect(mocks.prisma.$queryRaw.mock.calls[1]?.[1]).toEqual(['starter', 'welcome']);
  });

  it('keeps a starter page whose intro stays but which has new writing', async () => {
    mocks.rows.push(starter({ id: 'edited', content: `${STARTER_GETTING_STARTED_CONTENT}\n\nOur product syncs invoices.` }));
    mocks.rows.push(blankWelcome({ content: 'Welcome to your new documentation site.\n\nOur product syncs invoices.' }));

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows.map((row) => row.id)).toEqual(['edited', 'welcome']);
    expect(mocks.prisma.page.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps a starter page the writer renamed, even with its text untouched', async () => {
    mocks.rows.push(starter({ title: 'Introduction' }));
    mocks.rows.push(blankWelcome({ title: 'Start here' }));

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows).toHaveLength(2);
  });

  it.each([
    ['icon', { icon: 'book' }],
    ['description', { description: 'What our product does.' }],
    ['hidden', { hidden: true }],
    ['settings', { config: { sidebarTitle: 'Start' } }],
    ['translation link', { translationKey: 'intro' }],
  ])('keeps a starter page whose %s changed, even with its text untouched', async (_field, fields) => {
    mocks.rows.push(starter(fields));

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows).toHaveLength(1);
  });

  it('keeps an untouched starter page that has an authored child page', async () => {
    mocks.rows.push(starter());
    mocks.rows.push({ ...starter({ id: 'child', parentId: 'starter', slug: 'billing', title: 'Billing' }), content: 'Our billing guide.' });

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows.map((row) => row.id)).toEqual(['starter', 'child']);
  });

  it('keeps a starter page an autosave changed after the first read', async () => {
    mocks.rows.push(starter());
    // The autosave holds the page row; it commits just before the cleanup gets the lock.
    mocks.onLock.push(
      () => undefined,
      () => {
        (mocks.rows[0] as Row).content = `${STARTER_GETTING_STARTED_CONTENT}\n\nSaved by the writer.`;
      },
    );

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows[0]?.content).toContain('Saved by the writer.');
    expect(mocks.prisma.page.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps a starter page that gained a child after the first read', async () => {
    mocks.rows.push(starter());
    mocks.onLock.push(() => {
      mocks.rows.push({ ...starter({ id: 'child', parentId: 'starter', slug: 'new', title: 'New' }), content: 'A new page.' });
    });

    await expect(removeImportPlaceholders(target)).resolves.toBe(0);
    expect(mocks.rows.map((row) => row.id)).toEqual(['starter', 'child']);
  });

  it('recognises only the exact signature', () => {
    expect(isPristineStarterPage(starter())).toBe(true);
    expect(isPristineStarterPage(starter({ content: STARTER_GETTING_STARTED_CONTENT.replace('your product', 'Acme') }))).toBe(false);
    expect(isPristineStarterPage(blankWelcome())).toBe(true);
    expect(isPristineStarterPage(blankWelcome({ content: 'Welcome to your new documentation site.' }))).toBe(false);
  });
});
