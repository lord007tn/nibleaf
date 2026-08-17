import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  projectFind: vi.fn(),
  memberFind: vi.fn(),
  sessionFind: vi.fn(),
  sessionUpdate: vi.fn(),
  readerUpdate: vi.fn(),
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
  },
}));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://docs.example.com' } }));

import { resolveViewerAccess } from './reader-access';

const headers = (cookie?: string) => new Headers(cookie ? { cookie } : {});

describe('resolveViewerAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(null);
  });

  it('preserves anonymous access for the explicit PUBLIC default', async () => {
    await expect(resolveViewerAccess('project', 'PUBLIC', headers())).resolves.toEqual({ kind: 'public', allowedPageIds: null });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('denies anonymous readers and dedicated reader cookies in WORKSPACE mode', async () => {
    await expect(resolveViewerAccess('project', 'WORKSPACE', headers('nibleaf_reader_project=opaque'))).resolves.toBeNull();
    expect(mocks.sessionFind).not.toHaveBeenCalled();
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
