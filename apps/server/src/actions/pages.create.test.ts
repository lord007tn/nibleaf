import { createPageBody, updatePageBody } from '@nibleaf/validators';
import { expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), aggregate: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  prisma: { $transaction: async (run: (tx: unknown) => unknown) => run({ $queryRaw: vi.fn(), page: db }) },
}));
vi.mock('./branches', () => ({ getDefaultBranch: async () => ({ id: 'main' }) }));
vi.mock('./languages', () => ({ getDefaultLanguage: async () => ({ id: 'en' }) }));
vi.mock('./platform-events', () => ({ logFirstContentEdit: vi.fn() }));
vi.mock('@/lib/page-history', () => ({ snapshotPage: vi.fn() }));
vi.mock('@/lib/page-address-changes', () => ({}));

import { createPage } from './pages';

it('creates empty titles with unique usable slugs and accepts empty-title autosaves', async () => {
  const rows: Array<{ id: string; title: string; slug: string; path: string }> = [];
  db.findFirst.mockImplementation(async ({ where }) => rows.find((row) => row.slug === where.slug) ?? null);
  db.aggregate.mockResolvedValue({ _max: { position: null } });
  db.create.mockImplementation(async ({ data }) => {
    const row = { ...data, id: `page-${rows.length}` };
    rows.push(row);
    return row;
  });
  const body = createPageBody.parse({ title: '' });
  expect(updatePageBody.parse({ title: '', content: 'Draft body' }).title).toBe('');
  expect(await createPage('fixture', body)).toMatchObject({ title: '', slug: 'untitled', path: 'untitled' });
  expect(await createPage('fixture', body)).toMatchObject({ title: '', slug: 'untitled-2', path: 'untitled-2' });
  expect(await createPage('fixture', { title: 'Untitled', slug: 'legacy' })).toMatchObject({ title: 'Untitled', slug: 'legacy' });
});

it('refuses a group without a name, and gives a blank page title the untitled address', async () => {
  db.findFirst.mockResolvedValue(null);
  db.aggregate.mockResolvedValue({ _max: { position: null } });
  db.create.mockImplementation(async ({ data }) => ({ ...data, id: 'page-x' }));
  db.create.mockClear();
  await expect(createPage('fixture', createPageBody.parse({ title: '  ', kind: 'GROUP' }))).rejects.toMatchObject({ details: { field: 'title' } });
  expect(db.create).not.toHaveBeenCalled();
  expect(await createPage('fixture', createPageBody.parse({ title: '   ' }))).toMatchObject({ slug: 'untitled' });
});
