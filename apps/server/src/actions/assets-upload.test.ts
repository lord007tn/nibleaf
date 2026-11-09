import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), put: vi.fn(), reject: vi.fn(), remove: vi.fn(), provider: 'maxio' }));
vi.mock('@nibleaf/storage/keys', () => ({ keys: () => ({ STORAGE_PROVIDER: mocks.provider }) }));
vi.mock('@nibleaf/storage', () => ({ putObjectStream: mocks.put, deleteObject: mocks.remove, UPLOAD_PRESIGN_EXPIRES_IN_SECONDS: 600 }));
vi.mock('@nibleaf/database', () => ({
  prisma: { pendingAssetUpload: { findUnique: mocks.find, updateMany: mocks.claim }, $queryRaw: mocks.reject },
}));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));

import { uploadAsset } from './assets';

const token = 'a'.repeat(43);
const key = 'projects/project/assets/a.png';
const request = (type = 'image/png', size = '3') =>
  new Request('http://localhost/upload', { method: 'PUT', body: 'abc', headers: { 'content-type': type, 'content-length': size } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.provider = 'maxio';
  mocks.find.mockResolvedValue({ key, projectId: 'project', size: 3, contentType: 'image/png', urlExpiresAt: new Date(Date.now() + 660_000) });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.reject.mockResolvedValue([{ key }]);
  mocks.remove.mockResolvedValue(undefined);
});
it('binds the hashed token to the reservation and atomically spends it', async () => {
  await uploadAsset('org', 'project', token, request());
  expect(mocks.find).toHaveBeenCalledWith({ where: { uploadTokenHash: createHash('sha256').update(token).digest('hex') } });
  expect(mocks.put).toHaveBeenCalledWith(key, expect.any(ReadableStream), 3, 'image/png', expect.any(AbortSignal));
  mocks.claim.mockResolvedValue({ count: 0 });
  await expect(uploadAsset('org', 'project', token, request())).rejects.toThrow('already been used');
  expect(mocks.put).toHaveBeenCalledTimes(1);
});
it('rejects cross-project and expired tokens before storage', async () => {
  await expect(uploadAsset('org', 'other', token, request())).rejects.toThrow('expired');
  mocks.find.mockResolvedValue({ projectId: 'project', urlExpiresAt: new Date() });
  await expect(uploadAsset('org', 'project', token, request())).rejects.toThrow('expired');
  expect(mocks.put).not.toHaveBeenCalled();
});
it('rejects content type and length mismatches without consuming a capability', async () => {
  await expect(uploadAsset('org', 'project', token, request('image/jpeg'))).rejects.toThrow('headers');
  await expect(uploadAsset('org', 'project', token, request('image/png', '4'))).rejects.toThrow('headers');
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('retains a durable rejection and deletes partial storage on stream failure', async () => {
  mocks.put.mockRejectedValue(new Error('size exceeded'));
  await expect(uploadAsset('org', 'project', token, request())).rejects.toThrow('size exceeded');
  expect(mocks.reject).toHaveBeenCalledOnce();
  expect(mocks.remove).toHaveBeenCalledWith(key);
});
it.each(['s3', 'r2', 'b2', 'minio'])('does not accept proxy tokens for %s', async (provider) => {
  mocks.provider = provider;
  await expect(uploadAsset('org', 'project', token, request())).rejects.toThrow('Invalid upload token');
  expect(mocks.find).not.toHaveBeenCalled();
});
