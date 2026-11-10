import { MCP_PRESET_SCOPES } from '@nibleaf/shared/mcp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    mcpOAuthGrant: { deleteMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    oauthRefreshToken: { updateMany: vi.fn() },
    oauthAccessToken: { updateMany: vi.fn() },
    oauthConsent: { deleteMany: vi.fn() },
  };
  return {
    tx,
    readSignedOAuthQuery: vi.fn(),
    assertProjectAccess: vi.fn(),
    assertProjectInOrg: vi.fn(),
    sessionFindUnique: vi.fn(),
    clientFindUnique: vi.fn(),
    memberFindMany: vi.fn(),
    grantFindFirst: vi.fn(),
    grantFindMany: vi.fn(),
    queryRaw: vi.fn(),
  };
});

vi.mock('@/lib/access', () => ({
  accessibleProjectIds: async () => ['p-member', 'p-owner'],
  resolveSiteAccess: async (_user: string, id: string) => ({ role: id === 'p-owner' ? 'owner' : 'member' }),
}));
vi.mock('@nibleaf/auth/mcp-oauth', () => ({ MCP_OAUTH_PENDING_GRANT_TTL_MS: 15 * 60_000, readSignedOAuthQuery: mocks.readSignedOAuthQuery }));
vi.mock('@/env', () => ({ env: { BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters' } }));
vi.mock('./projects', () => ({ assertProjectAccess: mocks.assertProjectAccess, assertProjectInOrg: mocks.assertProjectInOrg }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { sql: (strings: TemplateStringsArray) => strings.join('?'), join: (values: unknown[]) => values },
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    oauthClient: { findUnique: mocks.clientFindUnique },
    project: {
      findMany: async () =>
        (await mocks.memberFindMany())
          .filter((m: { role: string }) => m.role !== 'unknown')
          .flatMap((m: { role: string; organization: { name: string; projects: { id: string }[] } }) =>
            m.organization.projects.map((p) => ({ ...p, organization: { id: `org-${m.role}`, name: m.organization.name } })),
          ),
    },
    member: { findMany: mocks.memberFindMany },
    mcpOAuthGrant: { findFirst: mocks.grantFindFirst, findMany: mocks.grantFindMany },
    $queryRaw: mocks.queryRaw,
    $transaction: (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx),
  },
}));

import { createMcpOAuthGrant, getMcpOAuthAuthorization, listConnectedApps, revokeConnectedApp } from './mcp-oauth';

const user = { id: 'user-1' };
const session = { id: 'session-1', userId: 'user-1' };
const body = (preset: 'read_only' | 'support_writer' | 'full_admin', projectId = 'project-1') => ({ oauthQuery: 'signed', projectId, preset });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSignedOAuthQuery.mockResolvedValue({
    query: 'signed',
    clientId: 'client-claude',
    scopes: ['mcp:connect'],
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  });
  mocks.clientFindUnique.mockResolvedValue({
    clientId: 'client-claude',
    name: 'Claude',
    uri: null,
    icon: null,
    clientDiscoveryId: null,
    disabled: false,
  });
  mocks.sessionFindUnique.mockResolvedValue({ impersonatedBy: null });
  mocks.assertProjectAccess.mockResolvedValue({ project: { id: 'project-1' }, organizationId: 'org-1', role: 'member' });
  mocks.tx.mcpOAuthGrant.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'grant-1', ...data }));
  mocks.queryRaw.mockResolvedValue([]);
});

describe('MCP OAuth project choice', () => {
  it('records a pending grant for this session and client with the preset scopes', async () => {
    const grant = await createMcpOAuthGrant(user, session, body('support_writer'));
    expect(grant).toMatchObject({ projectId: 'project-1', preset: 'support_writer', scopes: [...MCP_PRESET_SCOPES.support_writer] });
    expect(mocks.tx.mcpOAuthGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', sessionId: 'session-1', clientId: 'client-claude', clientName: 'Claude' }),
      }),
    );
    // A new choice replaces this session's earlier, unused choice for the client.
    expect(mocks.tx.mcpOAuthGrant.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        activatedAt: null,
        OR: [{ sessionId: 'session-1', clientId: 'client-claude' }, { createdAt: { lte: expect.any(Date) } }],
      },
    });
  });

  it('refuses Full admin to a member, as for personal keys', async () => {
    await expect(createMcpOAuthGrant(user, session, body('full_admin'))).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    expect(mocks.tx.mcpOAuthGrant.create).not.toHaveBeenCalled();
  });

  it('allows Full admin to an admin', async () => {
    mocks.assertProjectAccess.mockResolvedValue({ project: { id: 'project-1' }, organizationId: 'org-1', role: 'admin' });
    await expect(createMcpOAuthGrant(user, session, body('full_admin'))).resolves.toMatchObject({
      preset: 'full_admin',
      scopes: [...MCP_PRESET_SCOPES.full_admin],
    });
  });

  it('refuses a project the person does not belong to', async () => {
    mocks.assertProjectAccess.mockRejectedValue(Object.assign(new Error('project not found'), { code: 'database:not_found' }));
    await expect(createMcpOAuthGrant(user, session, body('read_only', 'project-elsewhere'))).rejects.toMatchObject({ code: 'database:not_found' });
    expect(mocks.assertProjectAccess).toHaveBeenCalledWith('user-1', 'project-elsewhere');
    expect(mocks.tx.mcpOAuthGrant.create).not.toHaveBeenCalled();
  });

  it('refuses an expired or forged authorization request, and support sessions', async () => {
    mocks.readSignedOAuthQuery.mockResolvedValueOnce(null);
    await expect(createMcpOAuthGrant(user, session, body('read_only'))).rejects.toMatchObject({ code: 'http:bad_request' });
    mocks.sessionFindUnique.mockResolvedValueOnce({ impersonatedBy: 'operator-1' });
    await expect(createMcpOAuthGrant(user, session, body('read_only'))).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    mocks.clientFindUnique.mockResolvedValueOnce({ clientId: 'client-claude', name: 'Claude', disabled: true });
    await expect(createMcpOAuthGrant(user, session, body('read_only'))).rejects.toMatchObject({ code: 'http:bad_request' });
    expect(mocks.tx.mcpOAuthGrant.create).not.toHaveBeenCalled();
  });

  it('offers each project with the presets the person’s role may grant', async () => {
    mocks.memberFindMany.mockResolvedValue([
      { role: 'member', organization: { name: 'Acme', projects: [{ id: 'p-member', name: 'Docs', slug: 'docs' }] } },
      { role: 'owner', organization: { name: 'My workspace', projects: [{ id: 'p-owner', name: 'Docs', slug: 'docs-2' }] } },
      { role: 'unknown', organization: { name: 'Other', projects: [{ id: 'p-unknown', name: 'Unknown role', slug: 'unknown' }] } },
    ]);
    mocks.grantFindFirst.mockResolvedValue(null);
    const authorization = await getMcpOAuthAuthorization(user, session, 'signed');
    expect(authorization.projects).toEqual([
      // Same-named projects stay distinguishable by workspace and address.
      {
        id: 'p-member',
        name: 'Docs',
        slug: 'docs',
        workspace: 'Acme',
        organization: { id: 'org-member', name: 'Acme' },
        role: 'member',
        presets: ['read_only', 'support_writer'],
      },
      {
        id: 'p-owner',
        name: 'Docs',
        slug: 'docs-2',
        workspace: 'My workspace',
        organization: { id: 'org-owner', name: 'My workspace' },
        role: 'owner',
        presets: ['read_only', 'support_writer', 'full_admin'],
      },
    ]);
    expect(authorization.client).toMatchObject({ name: 'Claude', redirectTarget: 'claude.ai', verifiedDomain: null });
    expect(authorization.selection).toBeNull();
  });
});

describe('Connected apps', () => {
  const row = (userId: string) => ({
    id: `grant-${userId}`,
    clientName: 'Claude',
    preset: 'read_only',
    scopes: ['mcp:connect'],
    createdAt: new Date(),
    lastUsedAt: null,
    user: { id: userId, name: userId, email: `${userId}@nibleaf.test` },
    client: { name: 'Claude', uri: null },
  });

  it('shows admins every live connection and members only their own', async () => {
    mocks.grantFindMany.mockResolvedValue([row('user-1')]);
    await listConnectedApps('org-1', 'project-1', { id: 'admin-1', role: 'admin' });
    expect(mocks.grantFindMany.mock.calls[0]?.[0].where).toEqual({ projectId: 'project-1', revokedAt: null, activatedAt: { not: null } });
    const mine = await listConnectedApps('org-1', 'project-1', { id: 'user-1', role: 'member' });
    expect(mocks.grantFindMany.mock.calls[1]?.[0].where).toEqual({
      projectId: 'project-1',
      revokedAt: null,
      activatedAt: { not: null },
      userId: 'user-1',
    });
    expect(mine[0]).toMatchObject({ id: 'grant-user-1', ownedByViewer: true, lastActivity: null });
    expect(mocks.assertProjectInOrg).toHaveBeenCalledWith('org-1', 'project-1');
  });

  it('lets a member disconnect only their own app', async () => {
    mocks.grantFindFirst.mockResolvedValue(null);
    await expect(revokeConnectedApp('org-1', 'project-1', 'grant-user-2', { id: 'user-1', role: 'member' })).rejects.toMatchObject({
      code: 'database:not_found',
    });
    expect(mocks.grantFindFirst.mock.calls[0]?.[0].where).toEqual({
      id: 'grant-user-2',
      projectId: 'project-1',
      activatedAt: { not: null },
      userId: 'user-1',
    });
    expect(mocks.tx.mcpOAuthGrant.updateMany).not.toHaveBeenCalled();
  });

  it('revokes the grant, its refresh and stored access tokens, and its consent', async () => {
    mocks.grantFindFirst.mockResolvedValue({ id: 'grant-user-2' });
    mocks.tx.mcpOAuthGrant.findUniqueOrThrow.mockResolvedValue(row('user-2'));
    const result = await revokeConnectedApp('org-1', 'project-1', 'grant-user-2', { id: 'admin-1', role: 'admin' });
    expect(mocks.grantFindFirst.mock.calls[0]?.[0].where).toEqual({ id: 'grant-user-2', projectId: 'project-1', activatedAt: { not: null } });
    expect(mocks.tx.mcpOAuthGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'grant-user-2', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedById: 'admin-1' },
    });
    expect(mocks.tx.oauthRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { referenceId: 'grant-user-2', revoked: null },
      data: { revoked: expect.any(Date) },
    });
    expect(mocks.tx.oauthAccessToken.updateMany).toHaveBeenCalledWith({
      where: { referenceId: 'grant-user-2', revoked: null },
      data: { revoked: expect.any(Date) },
    });
    expect(mocks.tx.oauthConsent.deleteMany).toHaveBeenCalledWith({ where: { referenceId: 'grant-user-2' } });
    expect(result).toMatchObject({ id: 'grant-user-2', ownedByViewer: false });
  });
});
