import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/storage/keys', () => ({ keys: () => ({ STORAGE_PROVIDER: mocks.provider }) }));

const mocks = vi.hoisted(() => ({
  provider: 's3',
  headObject: vi.fn(),
  storedImageDimensions: vi.fn(),
  imageDimensions: vi.fn(),
  upsert: vi.fn(),
  deleteObject: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  assertProjectInOrg: vi.fn(),
  presignPutUrl: vi.fn(),
  transaction: vi.fn(),
  pendingAggregate: vi.fn(),
  cleanupList: vi.fn(),
  pendingCreate: vi.fn(),
  pendingUpdate: vi.fn(),
  pendingDelete: vi.fn(),
  pendingDeleteMany: vi.fn(),
  pendingFindUnique: vi.fn(),
  reject: vi.fn(),
}));
const pending = () => ({
  aggregate: mocks.pendingAggregate,
  create: mocks.pendingCreate,
  update: mocks.pendingUpdate,
  delete: mocks.pendingDelete,
  deleteMany: mocks.pendingDeleteMany,
});
vi.mock('@nibleaf/database', () => ({
  prisma: {
    asset: { create: mocks.create, findUnique: mocks.findUnique, upsert: mocks.upsert },
    pendingAssetUpload: {
      aggregate: mocks.pendingAggregate,
      create: mocks.pendingCreate,
      update: mocks.pendingUpdate,
      delete: mocks.pendingDelete,
      deleteMany: mocks.pendingDeleteMany,
      findUnique: mocks.pendingFindUnique,
    },
    assetUploadTombstone: { findMany: mocks.cleanupList },
    $transaction: mocks.transaction,
    $queryRaw: mocks.reject,
  },
}));
vi.mock('@nibleaf/storage', () => ({
  UPLOAD_PRESIGN_EXPIRES_IN_SECONDS: 600,
  headObject: mocks.headObject,
  storedImageDimensions: mocks.storedImageDimensions,
  imageDimensions: mocks.imageDimensions,
  deleteObject: mocks.deleteObject,
  presignPutUrl: mocks.presignPutUrl,
  putObject: vi.fn(),
  isNotFound: (error: Error) => error.name === 'NotFound' || error.name === 'NoSuchKey',
}));
vi.mock('./projects', () => ({ assertProjectInOrg: mocks.assertProjectInOrg }));

import { confirmAsset, presignAsset, storeAsset } from './assets';
import { transactionLock } from './transaction-lock.test-helper';

const body = { key: 'projects/project/assets/file.png', contentType: 'image/png', size: 1024 };
const confirmed = { id: 'confirmed', projectId: 'project', key: body.key, size: 1024, contentType: 'image/png' };
describe('asset confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.provider = 's3';
    mocks.headObject.mockResolvedValue({ ContentLength: 1024, ContentType: 'image/png' });
    mocks.storedImageDimensions.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(null);
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue(confirmed);
    mocks.pendingAggregate.mockResolvedValue({ _sum: { size: 0 }, _count: { _all: 0 } });
    mocks.cleanupList.mockResolvedValue([]);
    mocks.pendingCreate.mockResolvedValue({});
    mocks.pendingUpdate.mockResolvedValue({});
    mocks.pendingDelete.mockResolvedValue({});
    mocks.pendingDeleteMany.mockResolvedValue({ count: 1 });
    mocks.pendingFindUnique.mockResolvedValue({ rejectedAt: null, size: body.size, contentType: body.contentType });
    mocks.reject.mockResolvedValue([{ key: body.key }]);
    const transaction = transactionLock();
    mocks.transaction.mockImplementation((work) =>
      transaction(work, {
        asset: { create: mocks.create, findUnique: mocks.findUnique },
        pendingAssetUpload: pending(),
        assetUploadTombstone: { findMany: mocks.cleanupList },
      }),
    );
  });

  it('counts every retained cleanup row and its bytes before the first successful recheck', async () => {
    mocks.cleanupList.mockResolvedValue(Array.from({ length: 10 }, () => ({ size: 50 * 1024 * 1024, firstRecheckedAt: null })));
    await expect(presignAsset('org', 'project', { filename: 'next.png', contentType: 'image/png', size: 1 })).rejects.toMatchObject({ status: 429 });
    mocks.cleanupList.mockResolvedValue(Array.from({ length: 10 }, () => ({ size: 50 * 1024 * 1024, firstRecheckedAt: new Date() })));
    await expect(presignAsset('org', 'project', { filename: 'next.png', contentType: 'image/png', size: 1 })).resolves.toHaveProperty('key');
    mocks.cleanupList.mockResolvedValue(Array.from({ length: 20 }, () => ({ size: 1024, firstRecheckedAt: new Date() })));
    await expect(presignAsset('org', 'project', { filename: 'next.png', contentType: 'image/png', size: 1 })).resolves.toHaveProperty('key');
    mocks.cleanupList.mockResolvedValue(Array.from({ length: 41 }, () => ({ size: 50 * 1024 * 1024, firstRecheckedAt: new Date() })));
    await expect(presignAsset('org', 'project', { filename: 'next.png', contentType: 'image/png', size: 1 })).resolves.toHaveProperty('key');
    mocks.cleanupList.mockResolvedValue(Array.from({ length: 500 }, () => ({ size: 1, firstRecheckedAt: new Date() })));
    await expect(presignAsset('org', 'project', { filename: 'next.png', contentType: 'image/png', size: 1 })).resolves.toHaveProperty('key');
  });

  it('records validated object metadata', async () => {
    await confirmAsset('org', 'project', 'user', body);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ size: 1024, contentType: 'image/png' }) });
  });

  it('records intrinsic sizes after validating a browser upload', async () => {
    mocks.storedImageDimensions.mockResolvedValue({ width: 1313, height: 900 });
    await confirmAsset('org', 'project', 'user', body);
    expect(mocks.storedImageDimensions).toHaveBeenCalledWith(body.key);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ width: 1313, height: 900 }) });
  });

  it('captures server-stored bytes and clears stale dimensions if replacement bytes cannot be parsed', async () => {
    mocks.imageDimensions.mockReturnValueOnce({ width: 950, height: 600 }).mockReturnValueOnce(null);
    const input = { projectId: 'project', filename: 'fixture.png', contentType: 'image/png', bytes: new Uint8Array([1]), importId: 'source' };
    await storeAsset(input);
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ update: { contentType: 'image/png', size: 1, width: 950, height: 600 } }),
    );
    await expect(storeAsset(input)).resolves.toBeUndefined();
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ update: { contentType: 'image/png', size: 1, width: null, height: null } }),
    );
  });

  it('does storage I/O once before an atomic database-only write batch', async () => {
    await confirmAsset('org', 'project', 'user', body);
    expect(mocks.headObject.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.headObject).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls.every(([work]) => Array.isArray(work))).toBe(true);
    expect(mocks.pendingUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({ key: body.key, cleanupStartedAt: null }),
      data: { cleanupStartedAt: null },
    });
    expect(mocks.pendingDelete).toHaveBeenCalledWith({ where: { key: body.key } });
  });

  it('returns the matching confirmed row on a retry without contacting storage', async () => {
    mocks.findUnique.mockResolvedValue(confirmed);
    mocks.headObject.mockRejectedValue(new Error('storage unavailable'));
    await expect(confirmAsset('org', 'project', 'user', body)).resolves.toEqual(confirmed);
    expect(mocks.headObject).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it.each([{ projectId: 'other' }, { size: 2048 }, { contentType: 'image/jpeg' }])(
    'refuses inconsistent confirmation retries: %j',
    async (different) => {
      mocks.findUnique.mockResolvedValue({ ...confirmed, ...different });
      await expect(confirmAsset('org', 'project', 'user', body)).rejects.toMatchObject({ status: 409 });
      expect(mocks.headObject).not.toHaveBeenCalled();
      expect(mocks.deleteObject).not.toHaveBeenCalled();
    },
  );

  it('preserves the object when the transaction fails', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('transaction timeout'));
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toThrow('transaction timeout');
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('refuses confirmation after cleanup claimed or removed the pending upload', async () => {
    mocks.pendingUpdate.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'P2025' }));
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toMatchObject({ status: 400, details: { reason: 'asset_upload_expired' } });
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2025'])('returns a matching row after a concurrent database conflict: %s', async (code) => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValue(confirmed);
    if (code === 'P2002') mocks.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code }));
    else mocks.pendingUpdate.mockRejectedValueOnce(Object.assign(new Error('missing'), { code }));
    await expect(confirmAsset('org', 'project', 'user', body)).resolves.toEqual(confirmed);
    expect(mocks.pendingDeleteMany).toHaveBeenCalledWith({ where: { key: body.key, projectId: 'project' } });
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('rejects a stored length that differs from the declaration', async () => {
    mocks.headObject.mockResolvedValue({ ContentLength: 2048, ContentType: 'image/png' });
    await expect(confirmAsset('org', 'project', 'user', { ...body, size: 1 })).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteObject).toHaveBeenCalledWith(body.key);
  });

  it('atomically marks rejection and shortens expiry to the signed URL window before deleting the object', async () => {
    mocks.headObject.mockResolvedValue({ ContentLength: 2048, ContentType: 'image/png' });
    await expect(confirmAsset('org', 'project', 'user', { ...body, size: 1 })).rejects.toMatchObject({ status: 400 });
    const sql = mocks.reject.mock.calls[0]?.[0].join('');
    expect(sql).toContain('"rejectedAt" = COALESCE');
    expect(sql).toContain('"cleanupStartedAt" = COALESCE');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "asset"');
    expect(sql).toContain('"expiresAt" = LEAST');
    expect(sql).toContain('pending."urlExpiresAt"');
    expect(mocks.reject.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteObject.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.pendingDelete).not.toHaveBeenCalled();
    expect(mocks.pendingDeleteMany).not.toHaveBeenCalled();
  });

  it('never deletes an object when confirmation won before the rejection claim', async () => {
    mocks.reject.mockResolvedValue([]);
    await expect(confirmAsset('org', 'project', 'user', { ...body, size: 1 })).rejects.toMatchObject({ status: 400 });
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('refuses a rejected key before HEAD even after a matching PUT', async () => {
    mocks.pendingFindUnique.mockResolvedValue({ rejectedAt: new Date() });
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toMatchObject({ status: 400, details: { reason: 'asset_upload_rejected' } });
    expect(mocks.headObject).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('counts rejected reservations until cleanup has completed for the project cap', async () => {
    await presignAsset('org', 'project', { filename: 'a.png', contentType: 'image/png', size: 1024 });
    expect(mocks.pendingAggregate).toHaveBeenCalledWith({
      where: { projectId: 'project' },
      _sum: { size: true },
      _count: { _all: true },
    });
  });

  it('passes the declared size to the upload signer', async () => {
    await presignAsset('org', 'project', { filename: 'a.png', contentType: 'image/png', size: 1024 });
    expect(mocks.presignPutUrl).toHaveBeenCalledWith(expect.objectContaining({ contentLength: 1024, contentType: 'image/png' }));
  });

  it.each(['s3', 'r2', 'b2', 'minio'])('keeps direct presigned PUTs for %s', async (provider) => {
    mocks.provider = provider;
    mocks.presignPutUrl.mockResolvedValue('https://storage.example/signed');
    expect((await presignAsset('org', 'project', { filename: 'a.png', contentType: 'image/png', size: 1024 })).uploadUrl).toBe(
      'https://storage.example/signed',
    );
    expect(mocks.pendingCreate.mock.calls[0]?.[0].data.uploadTokenHash).toBeNull();
  });

  it('binds a maxio API capability to the existing reservation instead of signing storage', async () => {
    mocks.provider = 'maxio';
    const upload = await presignAsset('org', 'project', { filename: 'a.png', contentType: 'image/png', size: 1024 });
    expect(upload.uploadUrl).toMatch(/^\/api\/app\/projects\/project\/assets\/upload\/[A-Za-z0-9_-]{43}$/);
    expect(mocks.pendingCreate.mock.calls[0]?.[0].data).toMatchObject({
      key: upload.key,
      size: 1024,
      contentType: 'image/png',
      uploadTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mocks.presignPutUrl).not.toHaveBeenCalled();
  });

  it('generates a flat key for filenames with path separators in the extension', async () => {
    const result = await presignAsset('org', 'project', { filename: 'a.png/other', contentType: 'image/png', size: 1024 });
    expect(result.key.split('/')).toHaveLength(4);
    expect(result.key).not.toContain('\\');
  });

  it.each(['.', '..', '', 'nested/file.png', '../../other/assets/file.png', 'nested\\file.png', 'file.png/'])(
    'rejects non-flat keys: %s',
    async (leaf) => {
      await expect(confirmAsset('org', 'project', 'user', { ...body, key: `projects/project/assets/${leaf}` })).rejects.toMatchObject({
        status: 400,
      });
      expect(mocks.headObject).not.toHaveBeenCalled();
      expect(mocks.deleteObject).not.toHaveBeenCalled();
    },
  );

  it.each(['NotFound', 'NoSuchKey'])('maps a missing upload (%s) to a bad request', async (name) => {
    mocks.headObject.mockRejectedValue(Object.assign(new Error('missing'), { name }));
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('maps a unique conflict to a conflict response', async () => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }));
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toMatchObject({ status: 409 });
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('returns the same row for concurrent matching confirms and preserves the confirmed object', async () => {
    let stored: typeof confirmed | null = null;
    mocks.findUnique.mockImplementation(async () => stored);
    mocks.create.mockImplementation(async () => {
      if (stored) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      stored = confirmed;
      return stored;
    });
    const results = await Promise.allSettled([confirmAsset('org', 'project', 'user', body), confirmAsset('org', 'project', 'user', body)]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { id: 'confirmed' } });
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: confirmed });
    expect(mocks.headObject).toHaveBeenCalledTimes(2);
    expect(stored).toEqual(confirmed);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('refuses inconsistent concurrent confirmation metadata without deleting the valid reserved object', async () => {
    let stored: typeof confirmed | null = null;
    mocks.findUnique.mockImplementation(async () => stored);
    mocks.headObject
      .mockResolvedValueOnce({ ContentLength: 1024, ContentType: 'image/png' })
      .mockResolvedValueOnce({ ContentLength: 1024, ContentType: 'image/png' });
    mocks.create.mockImplementation(async () => {
      if (stored) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      stored = confirmed;
      return stored;
    });
    const results = await Promise.allSettled([
      confirmAsset('org', 'project', 'user', body),
      confirmAsset('org', 'project', 'user', { ...body, size: 2048 }),
    ]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: confirmed });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { status: 400 } });
    expect(stored).toEqual(confirmed);
  });

  it('reserves the declared bytes before issuing a URL, through the first recheck window', async () => {
    const before = Date.now();
    await presignAsset('org', 'project', { filename: 'a.png', contentType: 'image/png', size: 1024 });
    const reservation = mocks.pendingCreate.mock.calls[0]?.[0]?.data;
    expect(reservation).toMatchObject({ projectId: 'project', size: 1024, contentType: 'image/png' });
    expect(reservation.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 41 * 60 * 1000);
    expect(mocks.pendingCreate.mock.invocationCallOrder[0]).toBeLessThan(mocks.presignPutUrl.mock.invocationCallOrder[0] ?? 0);
  });

  it('allows only one concurrent reservation for the last pending slot', async () => {
    let count = 19;
    mocks.pendingAggregate.mockImplementation(async () => ({ _sum: { size: count * 1024 }, _count: { _all: count } }));
    mocks.pendingCreate.mockImplementation(async () => {
      count++;
      return {};
    });
    const input = { filename: 'a.png', contentType: 'image/png', size: 1024 };
    const results = await Promise.allSettled([presignAsset('org', 'project', input), presignAsset('org', 'project', input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } });
    expect(mocks.presignPutUrl).toHaveBeenCalledTimes(1);
    expect(count).toBe(20);
  });

  it.each([
    { _sum: { size: 500 * 1024 * 1024 }, _count: { _all: 10 } },
    { _sum: { size: 20 }, _count: { _all: 20 } },
  ])('refuses presigning beyond the per-project pending budget: %j', async (usage) => {
    mocks.pendingAggregate.mockResolvedValue(usage);
    await expect(presignAsset('org', 'project', { filename: 'a.png', contentType: 'image/png', size: 1024 })).rejects.toMatchObject({
      status: 429,
      code: 'http:rate_limited',
      details: { reason: 'pending_asset_upload_limit' },
    });
    expect(mocks.presignPutUrl).not.toHaveBeenCalled();
    expect(mocks.pendingCreate).not.toHaveBeenCalled();
  });

  it('deletes an oversized object immediately while retaining cleanup bookkeeping', async () => {
    mocks.headObject.mockResolvedValue({ ContentLength: 50 * 1024 * 1024 + 1, ContentType: 'image/png' });
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toThrow();
    expect(mocks.deleteObject).toHaveBeenCalledWith(body.key);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['text/html', 'image/svg+xml', undefined])('rejects unsafe stored content types: %s', async (contentType) => {
    mocks.headObject.mockResolvedValue({ ContentLength: 1024, ContentType: contentType });
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toThrow();
    expect(mocks.deleteObject).toHaveBeenCalledWith(body.key);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects a mismatched stored type', async () => {
    mocks.headObject.mockResolvedValue({ ContentLength: 1024, ContentType: 'image/jpeg' });
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([0, undefined, Number.NaN])('rejects invalid stored lengths: %s', async (size) => {
    mocks.headObject.mockResolvedValue({ ContentLength: size, ContentType: 'image/png' });
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not read or delete objects outside the project', async () => {
    await expect(confirmAsset('org', 'project', 'user', { ...body, key: 'projects/other/assets/file.png' })).rejects.toThrow();
    expect(mocks.headObject).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('fails closed on storage errors', async () => {
    mocks.headObject.mockRejectedValue(new Error('storage unavailable'));
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toThrow('storage unavailable');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it('keeps rejection bookkeeping if the immediate object deletion fails', async () => {
    mocks.headObject.mockResolvedValue({ ContentLength: 2048, ContentType: 'image/png' });
    mocks.deleteObject.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(confirmAsset('org', 'project', 'user', { ...body, size: 1 })).rejects.toMatchObject({
      status: 400,
      details: { reason: 'asset_upload_mismatch' },
    });
    expect(mocks.reject).toHaveBeenCalledTimes(1);
    expect(mocks.pendingDelete).not.toHaveBeenCalled();
    expect(mocks.pendingDeleteMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('preserves already-confirmed objects on a repeated confirmation', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'existing' });
    mocks.headObject.mockResolvedValue({ ContentLength: 1024, ContentType: 'text/html' });
    await expect(confirmAsset('org', 'project', 'user', body)).rejects.toThrow();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.headObject).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
