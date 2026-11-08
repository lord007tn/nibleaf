import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  listTombstones: vi.fn(),
  claimPending: vi.fn(),
  claimTombstones: vi.fn(),
  stalePending: vi.fn(),
  staleTombstones: vi.fn(),
  release: vi.fn(),
  finish: vi.fn(),
  deleteObjects: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@nibleaf/database', () => {
  const queryRaw = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join('?');
    const keys = values.find(Array.isArray) as string[];
    if (sql.includes('SELECT "id" FROM "project"')) return [];
    if (sql.includes('WITH released AS')) return mocks.release(keys, values);
    if (sql.includes('WITH usage AS')) return mocks.finish(keys, values);
    if (sql.includes('UPDATE "pending_asset_upload"')) return mocks.claimPending(keys);
    if (sql.includes('UPDATE "asset_upload_tombstone"')) return mocks.claimTombstones(keys);
    if (sql.includes('DELETE FROM "pending_asset_upload"')) return mocks.stalePending(keys);
    if (sql.includes('DELETE FROM "asset_upload_tombstone"')) return mocks.staleTombstones(keys);
    throw new Error('Unexpected cleanup SQL');
  };
  return {
    prisma: {
      pendingAssetUpload: { findMany: mocks.list },
      assetUploadTombstone: { findMany: mocks.listTombstones },
      $queryRaw: queryRaw,
      $transaction: async (work: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>) => work({ $queryRaw: queryRaw }),
    },
  };
});
vi.mock('@nibleaf/storage', async (importOriginal) => ({
  deleteObjects: mocks.deleteObjects,
  StorageDeleteError: (await importOriginal<typeof import('@nibleaf/storage')>()).StorageDeleteError,
}));
vi.mock('@nibleaf/logger', () => ({ logger: { warn: mocks.warn } }));

import { StorageDeleteError } from '@nibleaf/storage';
import { startPendingAssetUploadSweeper, sweepAssetUploadTombstones, sweepPendingAssetUploads } from './pending-asset-uploads';

const now = new Date('2026-11-07T12:00:00Z');
const upload = { key: 'projects/project/assets/image.png' };
const full = Array.from({ length: 100 }, (_, index) => ({ key: `${upload.key}-${index}` }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([upload]);
  mocks.listTombstones.mockResolvedValue([]);
  mocks.claimPending.mockImplementation(async (keys: string[]) => keys.map((key) => ({ key })));
  mocks.claimTombstones.mockImplementation(async (keys: string[]) => keys.map((key) => ({ key })));
  mocks.stalePending.mockResolvedValue([]);
  mocks.staleTombstones.mockResolvedValue([]);
  mocks.release.mockImplementation(async (keys: string[]) => [{ count: keys.length }]);
  mocks.finish.mockImplementation(async (keys: string[]) => [{ count: keys.length }]);
  mocks.deleteObjects.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pending upload cleanup', () => {
  it('claims and deletes one bounded batch, then moves its reservations atomically', async () => {
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(1);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ expiresAt: { lte: now } }), take: 100 }));
    expect(mocks.deleteObjects).toHaveBeenCalledWith([upload.key]);
    expect(mocks.release.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.deleteObjects.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.release.mock.calls[0]?.[1]).toContain(30 * 60 * 1000);
    expect(mocks.release.mock.calls[0]?.[1]).toContain(23 * 60 * 60 * 1000);
  });

  it('never sends confirmed objects to storage deletion and counts their stale reservation removal as progress', async () => {
    mocks.list.mockResolvedValueOnce(full).mockResolvedValueOnce([upload]);
    mocks.claimPending.mockResolvedValue([]);
    mocks.stalePending.mockImplementation(async (keys: string[]) => keys.map((key) => ({ key })));
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(101);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.deleteObjects).not.toHaveBeenCalled();
  });

  it('retains failed reservations with backoff and retries on a later run', async () => {
    mocks.list.mockResolvedValueOnce([upload]).mockResolvedValue([]);
    mocks.deleteObjects.mockRejectedValueOnce(new Error('partial deletion'));
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(0);
    expect(mocks.release).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue([upload]);
    await expect(sweepPendingAssetUploads(new Date(now.getTime() + 5 * 60 * 1000))).resolves.toBe(1);
  });

  it('releases successful keys from a partial delete and continues draining other projects', async () => {
    const failed = full[0]?.key ?? '';
    mocks.list.mockResolvedValueOnce(full).mockResolvedValueOnce([upload]).mockResolvedValue([]);
    mocks.deleteObjects.mockImplementation(async (keys: string[]) => {
      if (keys.includes(failed)) throw new StorageDeleteError(1, keys.length - 1, 'AccessDenied', [failed]);
    });
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(100);
    expect(mocks.release.mock.calls[0]?.[0]).not.toContain(failed);
    expect(mocks.deleteObjects).toHaveBeenCalledTimes(2);
  });

  it('does not contact storage while no expired uploads exist', async () => {
    mocks.list.mockResolvedValue([]);
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(0);
    expect(mocks.claimPending).not.toHaveBeenCalled();
    expect(mocks.deleteObjects).not.toHaveBeenCalled();
  });

  it('drains 101 objects with two storage requests rather than one per object', async () => {
    mocks.list.mockResolvedValueOnce(full).mockResolvedValueOnce([upload]);
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(101);
    expect(mocks.deleteObjects.mock.calls.map(([keys]) => keys.length)).toEqual([100, 1]);
  });

  it('stops draining a full batch when no cleanup succeeds', async () => {
    mocks.list.mockResolvedValueOnce(full).mockResolvedValue([]);
    mocks.claimPending.mockResolvedValue([]);
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(0);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('stops starting batches after the thirty-second work budget', async () => {
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    mocks.list.mockResolvedValue(full);
    mocks.deleteObjects.mockImplementation(async () => {
      elapsed += 30_001;
    });
    try {
      await expect(sweepPendingAssetUploads(now)).resolves.toBe(100);
      expect(mocks.deleteObjects).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(['pending', 'tombstone'])('does not claim or increment retries when listing exhausts the %s sweep budget', async (kind) => {
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const list = kind === 'pending' ? mocks.list : mocks.listTombstones;
    list.mockImplementation(async () => {
      elapsed = 30_001;
      return full;
    });
    try {
      await (kind === 'pending' ? sweepPendingAssetUploads(now) : sweepAssetUploadTombstones(now));
      expect(mocks.claimPending).not.toHaveBeenCalled();
      expect(mocks.claimTombstones).not.toHaveBeenCalled();
      expect(mocks.deleteObjects).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('returns tombstone rechecks separately from released reservations', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.listTombstones.mockResolvedValue([upload]);
    await expect(sweepPendingAssetUploads(now)).resolves.toBe(0);
    expect(mocks.listTombstones).not.toHaveBeenCalled();
    await expect(sweepAssetUploadTombstones(now)).resolves.toBe(1);
    expect(mocks.finish.mock.calls[0]?.[1]).toContainEqual(new Date(now.getTime() - 23 * 60 * 60 * 1000));
  });

  it('retains failed tombstone rechecks and never deletes confirmed assets', async () => {
    mocks.listTombstones.mockResolvedValueOnce([upload]).mockResolvedValue([]);
    mocks.deleteObjects.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(sweepAssetUploadTombstones(now)).resolves.toBe(0);
    expect(mocks.finish).not.toHaveBeenCalled();
    mocks.listTombstones.mockResolvedValue([upload]);
    mocks.claimTombstones.mockResolvedValue([]);
    mocks.staleTombstones.mockResolvedValue([upload]);
    await expect(sweepAssetUploadTombstones(now)).resolves.toBe(0);
    expect(mocks.deleteObjects).toHaveBeenCalledTimes(1);
  });

  it('runs at startup and every fifteen minutes without overlapping passes', async () => {
    vi.useFakeTimers();
    let release: (value: unknown[]) => void = () => undefined;
    mocks.list
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const timer = startPendingAssetUploadSweeper();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      release([]);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(mocks.list).toHaveBeenCalledTimes(2);
    } finally {
      clearInterval(timer);
    }
  });
});
