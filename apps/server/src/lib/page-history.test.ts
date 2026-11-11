import type { Page, Prisma } from '@nibleaf/database';
import { PAGE_REVISION_MAX_BYTES } from '@nibleaf/shared/page-history';
import { describe, expect, it, vi } from 'vitest';
import { snapshotPage } from './page-history';

const fixture = () => {
  const tx = {
    pageRevision: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    pageRevisionState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    $executeRaw: vi.fn(),
  };
  const page = { id: 'page', projectId: 'project', kind: 'PAGE', title: 'Guide', content: 'Old' } as Page;
  return { tx, client: tx as unknown as Prisma.TransactionClient, page };
};

describe('snapshot policy under the page lock', () => {
  it('saves the new draft, attributes it, and prunes in the supplied transaction', async () => {
    const { tx, client, page } = fixture();
    expect(await snapshotPage(client, page, { title: 'Guide', content: 'New' }, 'author', false)).toBe('stored');
    expect(tx.pageRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'project', pageId: 'page', userId: 'author', content: 'New', reason: 'autosave', contentBytes: 8 }),
    });
    expect(tx.pageRevision.create).toHaveBeenCalledBefore(tx.$executeRaw);
    expect(tx.pageRevisionState.findUnique).toHaveBeenCalledWith({ where: { pageId_userId: { pageId: 'page', userId: 'author' } } });
  });

  it('bounds oversized autosaves and refuses a restore before any mutation when its undo copy exceeds the cap', async () => {
    const { tx, client, page } = fixture();
    expect(await snapshotPage(client, page, { title: 'Guide', content: 'x'.repeat(PAGE_REVISION_MAX_BYTES) }, 'author', false)).toBe('too-large');
    expect(tx.pageRevision.create).not.toHaveBeenCalled();
    tx.pageRevisionState.upsert.mockClear();
    await expect(
      snapshotPage(client, { ...page, content: 'x'.repeat(PAGE_REVISION_MAX_BYTES) }, { title: 'Guide', content: 'Restored' }, 'author', true),
    ).rejects.toMatchObject({ status: 400, details: { reason: 'history_snapshot_too_large' } });
    expect(tx.pageRevisionState.upsert).not.toHaveBeenCalled();
  });

  it('bypasses throttling before a restore and reuses an identical latest safety copy', async () => {
    const { tx, client, page } = fixture();
    await snapshotPage(client, page, { title: 'Old title', content: 'Restored' }, 'author', true);
    expect(tx.pageRevisionState.findUnique).not.toHaveBeenCalled();
    expect(tx.pageRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Guide', content: 'Old', reason: 'before-restore' }),
    });
    tx.pageRevision.create.mockClear();
    tx.pageRevision.findFirst.mockResolvedValue({ title: 'Guide', content: 'Old' });
    expect(await snapshotPage(client, page, { title: 'Guide', content: 'Restored' }, 'author', true)).toBe('unchanged');
    expect(tx.pageRevision.create).not.toHaveBeenCalled();
  });
});
