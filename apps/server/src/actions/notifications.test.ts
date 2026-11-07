import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ project: vi.fn(), members: vi.fn(), insert: vi.fn(), list: vi.fn(), update: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findUnique: mocks.project },
    member: { findMany: mocks.members },
    notification: { createMany: mocks.insert, findMany: mocks.list, updateMany: mocks.update },
  },
}));

import { createNotificationsForOrgMembers, listNotifications, markNotificationsRead } from './notifications';

describe('structured personal notifications', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.project.mockResolvedValue({ organizationId: 'org-1' });
    mocks.members.mockResolvedValue([{ userId: 'recipient-1' }]);
    mocks.insert.mockResolvedValue({ count: 1 });
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
    expect(mocks.members).toHaveBeenCalledWith({ where: { organizationId: 'org-1', userId: { not: 'actor-1' } }, select: { userId: true } });
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
    expect(await listNotifications('recipient-1')).toEqual({ items: rows, nextCursor: null });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'recipient-1' } }));
  });

  it('continues to scope mark-read to the session user', async () => {
    mocks.update.mockResolvedValue({ count: 1 });
    await markNotificationsRead('recipient-1', { ids: ['someone-elses-row'] });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { userId: 'recipient-1', readAt: null, id: { in: ['someone-elses-row'] } },
      data: { readAt: expect.any(Date) },
    });
  });
});
