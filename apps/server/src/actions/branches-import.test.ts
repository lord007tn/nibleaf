import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  branch: { findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  page: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  project: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({ prisma: db }));

import { captureImportDraft, promoteImportReplacementBranch } from './branches';

beforeEach(() => {
  vi.resetAllMocks();
  db.branch.findMany.mockResolvedValue([{ id: 'main', isDefault: true }]);
  db.branch.findFirst.mockResolvedValue({ id: 'import', isDefault: false });
  db.page.findMany.mockResolvedValue([{ id: 'page', content: 'Original' }]);
  db.project.findUniqueOrThrow.mockResolvedValue({ config: {} });
  db.$transaction.mockImplementation(async (fn) => fn(db));
});
it.each(['edit', 'insert', 'delete', 'config'])('preserves concurrent %s and returns a conflict', async (change) => {
  const snapshot = await captureImportDraft('project');
  if (change === 'edit') db.page.findMany.mockResolvedValue([{ id: 'page', content: 'Edited' }]);
  if (change === 'insert') db.page.findMany.mockResolvedValue([{ id: 'page', content: 'Original' }, { id: 'new' }]);
  if (change === 'delete') db.page.findMany.mockResolvedValue([]);
  if (change === 'config') db.project.findUniqueOrThrow.mockResolvedValue({ config: { title: 'Changed' } });
  await expect(promoteImportReplacementBranch('project', 'import', undefined, snapshot)).rejects.toMatchObject({ status: 409 });
  expect(db.page.deleteMany).not.toHaveBeenCalled();
  expect(db.page.updateMany).not.toHaveBeenCalled();
});
it('promotes an unchanged snapshot in a serializable transaction', async () => {
  const snapshot = await captureImportDraft('project');
  await promoteImportReplacementBranch('project', 'import', undefined, snapshot);
  expect(db.page.deleteMany).toHaveBeenCalledOnce();
  expect(db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 30_000 });
});

it('returns a conflict when promotion encounters a serialization failure', async () => {
  const snapshot = await captureImportDraft('project');
  db.$transaction.mockRejectedValueOnce({ code: 'P2034' });
  await expect(promoteImportReplacementBranch('project', 'import', undefined, snapshot)).rejects.toMatchObject({ status: 409 });
});

it('uses metadata without loading page content for fingerprints', async () => {
  await captureImportDraft('project');
  const args = db.page.findMany.mock.calls[0]?.[0];
  expect(args.select.updatedAt).toBe(true);
  expect(args.select.content).toBeUndefined();
});
it('maps transaction expiration on snapshot and promotion', async () => {
  db.$transaction.mockRejectedValueOnce({ code: 'P2028' });
  await expect(captureImportDraft('project')).rejects.toMatchObject({ status: 503, code: 'import:busy' });
  db.$transaction.mockRejectedValueOnce({ code: 'P2028' });
  await expect(promoteImportReplacementBranch('project', 'import')).rejects.toMatchObject({ status: 503 });
});
