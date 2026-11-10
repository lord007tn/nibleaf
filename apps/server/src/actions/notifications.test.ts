import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  projects: vi.fn(),
  orgs: vi.fn(),
  members: vi.fn(),
  insert: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  accessible: vi.fn(),
}));
vi.mock('@/lib/access', () => ({ accessibleProjectIds: mocks.accessible }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findUnique: mocks.project, findMany: mocks.projects },
    organization: { findMany: mocks.orgs },
    member: { findMany: mocks.members },
    notification: { createMany: mocks.insert, findMany: mocks.list, updateMany: mocks.update },
  },
}));

import { createNotificationsForOrgMembers, listNotifications, markNotificationsRead } from './notifications';

describe('structured personal notifications', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.project.mockResolvedValue({ organizationId: 'org-1' });
    mocks.members.mockResolvedValue([{ userId: 'recipient-1', organizationId: 'org-1', orgRole: 'member', projectGrants: [{ role: 'viewer' }] }]);
    mocks.insert.mockResolvedValue({ count: 1 });
    mocks.accessible.mockResolvedValue(['project-1']);
    mocks.projects.mockResolvedValue([]);
    mocks.orgs.mockResolvedValue([]);
  });

  it('keeps parameters and legacy text, scoped to fellow organization members', async () => {
    await createNotificationsForOrgMembers(
      'project-1',
      {
        type: 'import_completed',
        title: 'Content import completed',
        body: 'Legacy text',
        params: { imported: 3, updated: 1 },
      },
      'actor-1',
    );
    expect(mocks.members).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1', userId: { not: 'actor-1' }, OR: expect.any(Array) }) }),
    );
    expect(mocks.insert).toHaveBeenCalledWith({
      data: [
        {
          userId: 'recipient-1',
          projectId: 'project-1',
          type: 'import_completed',
          title: 'Content import completed',
          body: 'Legacy text',
          params: { imported: 3, updated: 1 },
          href: null,
        },
      ],
    });
  });

  it('lists both old and structured rows without changing their payloads', async () => {
    const rows = [
      { id: 'new', params: { version: 3 } },
      { id: 'old', params: null, title: 'Legacy title' },
    ];
    mocks.list.mockResolvedValue(rows);
    expect(await listNotifications('recipient-1')).toEqual({
      items: rows.map((row) => ({ ...row, organization: null, project: null })),
      nextCursor: null,
    });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'recipient-1', OR: expect.any(Array) }) }),
    );
  });

  it('labels each item with its website and organization as they are now', async () => {
    const acme = { id: 'org-1', slug: 'acme', name: 'Acme', logo: null };
    const sara = { id: 'org-2', slug: 'sara', name: "Sara's org", logo: 'https://logo' };
    mocks.list.mockResolvedValue([
      { id: 'site-event', projectId: 'project-1', organizationId: null },
      { id: 'org-event', projectId: null, organizationId: 'org-2' },
    ]);
    mocks.projects.mockResolvedValue([{ id: 'project-1', name: 'Docs', organizationId: 'org-1' }]);
    mocks.orgs.mockResolvedValue([acme, sara]);
    const { items } = await listNotifications('recipient-1');
    expect(items.map(({ id, organization, project }) => ({ id, organization, project }))).toEqual([
      { id: 'site-event', organization: acme, project: { id: 'project-1', name: 'Docs' } },
      { id: 'org-event', organization: sara, project: null },
    ]);
  });

  it('narrows the inbox to one organization through the access rules', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.members.mockResolvedValue([{ organizationId: 'org-2' }]);
    await listNotifications('recipient-1', undefined, 'org-2');
    expect(mocks.accessible).toHaveBeenCalledWith('recipient-1', 'org-2');
    expect(mocks.members).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'recipient-1', organizationId: 'org-2' }) }),
    );
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'recipient-1', OR: [{ projectId: { in: ['project-1'] } }, { projectId: null, organizationId: { in: ['org-2'] } }] },
      }),
    );
  });

  it('continues to scope mark-read to the session user', async () => {
    mocks.update.mockResolvedValue({ count: 1 });
    await markNotificationsRead('recipient-1', { ids: ['someone-elses-row'] });
    expect(mocks.update).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'recipient-1', readAt: null, id: { in: ['someone-elses-row'] }, OR: expect.any(Array) }),
      data: { readAt: expect.any(Date) },
    });
  });
});
