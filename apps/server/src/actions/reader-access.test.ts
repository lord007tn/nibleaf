import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  projectFind: vi.fn(),
  memberFind: vi.fn(),
  sessionFind: vi.fn(),
  sessionUpdate: vi.fn(),
  readerUpdate: vi.fn(),
  memberSessionFind: vi.fn(),
  memberSessionUpdate: vi.fn(),
}));

vi.mock('@nibleaf/auth/server', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { EMAIL: 'email' } }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    project: { findUnique: mocks.projectFind },
    member: { findUnique: mocks.memberFind },
    readerSession: { findFirst: mocks.sessionFind, update: mocks.sessionUpdate },
    reader: { update: mocks.readerUpdate },
    siteMemberSession: { findFirst: mocks.memberSessionFind, update: mocks.memberSessionUpdate },
  },
}));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://docs.example.com' } }));

import { jwtReaderIdentity, resolveViewerAccess } from './reader-access';

const headers = (cookie?: string) => new Headers(cookie ? { cookie } : {});

describe('resolveViewerAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(null);
    mocks.memberSessionFind.mockResolvedValue(null);
  });

  it('preserves anonymous access for the explicit PUBLIC default', async () => {
    await expect(resolveViewerAccess('project', 'PUBLIC', headers())).resolves.toEqual({ kind: 'public', allowedPageIds: null });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('denies anonymous readers and dedicated reader cookies in WORKSPACE mode', async () => {
    await expect(resolveViewerAccess('project', 'WORKSPACE', headers('nibleaf_reader_project=opaque'))).resolves.toBeNull();
    expect(mocks.sessionFind).not.toHaveBeenCalled();
  });

  it('lets a team member signed in on the site read in both private modes while they remain a member', async () => {
    mocks.memberSessionFind.mockResolvedValue({ id: 'site-session', userId: 'user', lastUsedAt: new Date(), project: { organizationId: 'org' } });
    mocks.memberFind.mockResolvedValue({ id: 'member' });
    for (const mode of ['WORKSPACE', 'READERS'] as const) {
      await expect(resolveViewerAccess('project', mode, headers('nibleaf_reader_project=opaque'))).resolves.toEqual({
        kind: 'workspace',
        allowedPageIds: null,
        siteSession: true,
      });
    }
    expect(mocks.memberFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId_userId: { organizationId: 'org', userId: 'user' } } }),
    );
    mocks.memberFind.mockResolvedValue(null);
    await expect(resolveViewerAccess('project', 'WORKSPACE', headers('nibleaf_reader_project=opaque'))).resolves.toBeNull();
  });

  it('grants full private access to an owning workspace member', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user' } });
    mocks.projectFind.mockResolvedValue({ organizationId: 'org' });
    mocks.memberFind.mockResolvedValue({ id: 'member' });
    await expect(resolveViewerAccess('project', 'READERS', headers())).resolves.toEqual({ kind: 'workspace', allowedPageIds: null });
  });

  it('returns only page ids granted through the active reader audiences', async () => {
    mocks.sessionFind.mockResolvedValue({
      id: 'session',
      readerId: 'reader',
      lastUsedAt: new Date(),
      reader: {
        audiences: [{ audience: { grants: [{ pageId: 'page-a' }, { pageId: 'page-b' }] } }, { audience: { grants: [{ pageId: 'page-b' }] } }],
      },
    });
    const result = await resolveViewerAccess('project', 'READERS', headers('nibleaf_reader_project=opaque'));
    expect(result?.kind).toBe('reader');
    expect([...(result?.allowedPageIds ?? [])]).toEqual(['page-a', 'page-b']);
  });

  it('treats a site-level audience grant as full-site reader access', async () => {
    mocks.sessionFind.mockResolvedValue({
      id: 'session',
      readerId: 'reader',
      lastUsedAt: new Date(),
      reader: { audiences: [{ audience: { grants: [{ pageId: null }, { pageId: 'page-a' }] } }] },
    });
    await expect(resolveViewerAccess('project', 'READERS', headers('nibleaf_reader_project=opaque'))).resolves.toMatchObject({
      kind: 'reader',
      allowedPageIds: null,
    });
  });

  it('denies missing, expired, or revoked reader sessions without leaking site existence', async () => {
    mocks.sessionFind.mockResolvedValue(null);
    await expect(resolveViewerAccess('project', 'READERS', headers('nibleaf_reader_project=revoked'))).resolves.toBeNull();
  });
});

describe('jwtReaderIdentity', () => {
  it('stores no NUL byte, which PostgreSQL text rejects', () => {
    expect(jwtReaderIdentity('https://idp.example.com', 'user-1')).not.toContain(String.fromCharCode(0));
  });

  it('keeps issuer and subject apart even when either contains separator-like text', () => {
    expect(jwtReaderIdentity('https://idp.example.com', 'a","b')).not.toBe(jwtReaderIdentity('https://idp.example.com","a', 'b'));
    expect(jwtReaderIdentity('https://a.example', 'b')).not.toBe(jwtReaderIdentity('https://a.exampleb', ''));
    expect(JSON.parse(jwtReaderIdentity('https://idp.example.com', 'user-1'))).toEqual(['https://idp.example.com', 'user-1']);
  });
});
