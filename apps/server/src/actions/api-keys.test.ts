import type { RotateApiKeyBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: { $transaction: database.transaction },
}));
vi.mock('@nibleaf/shared/crypto', () => ({ hashApiKeySecret: (secret: string) => `hashed:${secret}` }));
vi.mock('@nibleaf/shared/ids', () => ({ newApiKeySecret: vi.fn(() => ({ secret: `plm_live_${'a'.repeat(32)}` })) }));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn().mockResolvedValue({ id: 'project-1' }) }));

import { rotateApiKey } from './api-keys';

const current = { id: 'key-1', name: 'Docs reader' };
const successor = {
  id: 'key-2',
  name: current.name,
  lastFour: 'aaaa',
  scopes: ['mcp:connect', 'projects:read'],
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
  lastUsedAt: null,
  expiresAt: new Date('2026-11-22T00:00:00.000Z'),
  revokedAt: null,
  rotatedFromId: current.id,
};
const body = { scopes: ['mcp:connect', 'projects:read'], expiresInDays: 90 } satisfies RotateApiKeyBody;

describe('API-key rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.transaction.mockImplementation((callback) =>
      callback({ apiKey: { create: database.create, findFirst: database.findFirst, updateMany: database.updateMany } }),
    );
    database.findFirst.mockResolvedValue(current);
    database.create.mockResolvedValue(successor);
  });

  it('allows only one concurrent rotation to claim the current key', async () => {
    database.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      rotateApiKey('org-1', 'project-1', current.id, 'user-1', body),
      rotateApiKey('org-1', 'project-1', current.id, 'user-1', body),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'database:conflict', message: 'API key has already been rotated or revoked.' },
    });
    expect(database.create).toHaveBeenCalledOnce();
  });

  it('returns a stable conflict and never creates a successor for a revoked key', async () => {
    database.updateMany.mockResolvedValue({ count: 0 });

    await expect(rotateApiKey('org-1', 'project-1', current.id, 'user-1', body)).rejects.toMatchObject({
      code: 'database:conflict',
    });
    expect(database.create).not.toHaveBeenCalled();
  });
});
