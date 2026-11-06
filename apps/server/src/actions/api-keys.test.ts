import type { RotateApiKeyBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  Prisma: { sql: vi.fn(), join: vi.fn() },
  prisma: { $transaction: database.transaction, apiKey: database, $queryRaw: database.audit },
}));
vi.mock('@nibleaf/shared/crypto', () => ({ hashApiKeySecret: (secret: string) => `hashed:${secret}` }));
vi.mock('@nibleaf/shared/ids', () => ({ newApiKeySecret: vi.fn(() => ({ secret: `plm_live_${'a'.repeat(32)}` })) }));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn().mockResolvedValue({ id: 'project-1' }) }));

import { MemberRole } from '@nibleaf/shared/constants';

import { MCP_PRESET_SCOPES, MCP_SCOPE_MIN_ROLE } from '@nibleaf/shared/mcp';
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from './api-keys';

const member = { id: 'user-1', role: MemberRole.MEMBER };
const admin = { id: 'admin-1', role: MemberRole.ADMIN };
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
      rotateApiKey('org-1', 'project-1', current.id, { id: 'user-1', role: 'member' }, body),
      rotateApiKey('org-1', 'project-1', current.id, { id: 'user-1', role: 'member' }, body),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'database:conflict', message: 'API key has already been rotated or revoked.' },
    });
    expect(database.create).toHaveBeenCalledOnce();
  });

  it('returns a stable conflict and never creates a successor for a revoked key', async () => {
    database.updateMany.mockResolvedValue({ count: 0 });

    await expect(rotateApiKey('org-1', 'project-1', current.id, { id: 'user-1', role: 'member' }, body)).rejects.toMatchObject({
      code: 'database:conflict',
    });
    expect(database.create).not.toHaveBeenCalled();
  });
});

describe('personal key permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.create.mockResolvedValue(successor);
    database.findMany.mockResolvedValue([successor]);
    database.audit.mockResolvedValue([{ apiKeyId: successor.id, operation: 'get_page', outcome: 'success', at: new Date() }]);
    database.findFirst.mockImplementation(({ where }) => Promise.resolve(where.createdById ? null : current));
    database.update.mockResolvedValue(successor);
  });
  it('creates a support writer owned by the caller with expanded scopes', async () => {
    await createApiKey('org-1', 'project-1', member, { name: 'Support', preset: 'support_writer', expiresInDays: 90 });
    expect(database.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: member.id, scopes: MCP_PRESET_SCOPES.support_writer }) }),
    );
  });
  it('denies full admin to members', async () => {
    await expect(createApiKey('org-1', 'project-1', member, { name: 'Admin', preset: 'full_admin', expiresInDays: 90 })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    expect(database.create).not.toHaveBeenCalled();
  });
  it('consults scope role policy for explicit scopes and rotation', async () => {
    const original = MCP_SCOPE_MIN_ROLE['pages:write'];
    MCP_SCOPE_MIN_ROLE['pages:write'] = MemberRole.ADMIN;
    try {
      await expect(
        createApiKey('org-1', 'project-1', member, { name: 'Writer', scopes: ['mcp:connect', 'pages:write'], expiresInDays: 90 }),
      ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
      await expect(
        rotateApiKey('org-1', 'project-1', current.id, member, { scopes: ['mcp:connect', 'pages:write'], expiresInDays: 90 }),
      ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    } finally {
      MCP_SCOPE_MIN_ROLE['pages:write'] = original;
    }
  });
  it('filters member lists and attaches newest activity in a single bounded query', async () => {
    const keys = await listApiKeys('org-1', 'project-1', member);
    expect(database.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'project-1', createdById: member.id } }));
    expect(database.audit).toHaveBeenCalledOnce();
    expect(keys[0]).toMatchObject({ preset: 'custom', lastActivity: { operation: 'get_page', outcome: 'success' } });
  });
  it('includes the audit error code in the newest activity', async () => {
    const { Prisma } = await import('@nibleaf/database');
    database.audit.mockResolvedValue([
      { apiKeyId: successor.id, operation: 'publish_changes', outcome: 'failed', errorCode: 'mcp:scope_required', at: new Date() },
    ]);
    const keys = await listApiKeys('org-1', 'project-1', member);
    expect(vi.mocked(Prisma.sql).mock.calls[0]?.[0].join('')).toContain('"errorCode"');
    expect(keys[0]?.lastActivity).toMatchObject({ operation: 'publish_changes', outcome: 'failed', errorCode: 'mcp:scope_required' });
  });
  it.each(['read_only', 'support_writer', 'full_admin'] as const)('derives exact preset %s', async (preset) => {
    database.findMany.mockResolvedValue([{ ...successor, scopes: [...MCP_PRESET_SCOPES[preset]].reverse() }]);
    expect((await listApiKeys('org-1', 'project-1', admin))[0]?.preset).toBe(preset);
    expect(database.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'project-1' } }));
  });
  it('conceals others keys on revoke and rotate', async () => {
    await expect(revokeApiKey('org-1', 'project-1', current.id, member)).rejects.toMatchObject({ status: 404 });
    await expect(rotateApiKey('org-1', 'project-1', current.id, member, body)).rejects.toMatchObject({ status: 404 });
    expect(database.update).not.toHaveBeenCalled();
    expect(database.create).not.toHaveBeenCalled();
  });
  it('lets admins revoke another member key but not rotate it into their own identity', async () => {
    database.updateMany.mockResolvedValue({ count: 1 });
    await revokeApiKey('org-1', 'project-1', current.id, admin);
    expect(database.update).toHaveBeenCalledOnce();
    await expect(rotateApiKey('org-1', 'project-1', current.id, admin, body)).rejects.toMatchObject({ status: 404 });
    expect(database.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: current.id, projectId: 'project-1', createdById: admin.id } }),
    );
    expect(database.create).not.toHaveBeenCalled();
  });
  it('rotates the caller own key as the caller', async () => {
    database.findFirst.mockResolvedValue(current);
    database.updateMany.mockResolvedValue({ count: 1 });
    await rotateApiKey('org-1', 'project-1', current.id, admin, body);
    expect(database.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ createdById: admin.id }) }));
  });
});
