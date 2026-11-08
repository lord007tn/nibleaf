import { randomUUID } from 'node:crypto';
import { MemberRole } from '@nibleaf/shared/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Opt in only against a migrated test database. Every fixture is synthetic and
// cleanup is restricted to the exact IDs created by this suite.
describe.skipIf(process.env.VIEWER_ROLE_INTEGRATION !== '1')('Viewer role in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let members: typeof import('./members');
  let projects: typeof import('./projects');
  let guard: typeof import('@/middlewares/guard');
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    members = await import('./members');
    projects = await import('./projects');
    guard = await import('@/middlewares/guard');
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const person = async (label: string) => {
    const user = await db.prisma.user.create({ data: { email: `${label}-${randomUUID()}@nibleaf.test`, name: label, emailVerified: true } });
    userIds.push(user.id);
    return user;
  };

  /** One site with its own organization and a member at every role. */
  const site = async () => {
    const id = `viewer-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id, slug: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const team = {} as Record<'owner' | 'admin' | 'editor' | 'viewer', { userId: string; memberId: string }>;
    for (const [key, role] of [
      ['owner', MemberRole.OWNER],
      ['admin', MemberRole.ADMIN],
      ['editor', MemberRole.MEMBER],
      ['viewer', MemberRole.VIEWER],
    ] as const) {
      const user = await person(key);
      const member = await db.prisma.member.create({ data: { organizationId: organization.id, userId: user.id, role } });
      team[key] = { userId: user.id, memberId: member.id };
    }
    return { organization, project, team };
  };

  /** Run a guard the way Hono does, against the real database. */
  const runGuard = async (middleware: ReturnType<typeof guard.requireProjectRole>, userId: string, projectId: string) => {
    const values = new Map<string, unknown>([['user', { id: userId }]]);
    const ctx = {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
      req: { param: () => projectId },
    };
    let passed = false;
    await middleware(ctx as never, async () => {
      passed = true;
    });
    return { passed, membership: values.get('membership') as { role: string } | undefined };
  };

  it('lets a Viewer through read guards and stops them at every Editor guard', async () => {
    const { project, team } = await site();
    const read = await runGuard(guard.requireProjectMember(), team.viewer.userId, project.id);
    expect(read).toMatchObject({ passed: true, membership: { role: MemberRole.VIEWER } });
    await expect(runGuard(guard.requireProjectRole(MemberRole.MEMBER), team.viewer.userId, project.id)).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    await expect(runGuard(guard.requireProjectRole(MemberRole.ADMIN), team.viewer.userId, project.id)).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    // Existing Editors keep their access unchanged.
    expect((await runGuard(guard.requireProjectRole(MemberRole.MEMBER), team.editor.userId, project.id)).passed).toBe(true);
    expect((await projects.assertProjectAccess(team.viewer.userId, project.id)).role).toBe(MemberRole.VIEWER);
  });

  it('lets an Admin invite a Viewer and move people between Viewer and Editor', async () => {
    const { organization, team } = await site();
    const invitation = await members.inviteMember(
      organization.id,
      team.admin.userId,
      MemberRole.ADMIN,
      { email: `new-viewer-${randomUUID()}@nibleaf.test`, role: MemberRole.VIEWER },
      { sendEmail: false },
    );
    expect(invitation.role).toBe(MemberRole.VIEWER);

    const demoted = await members.updateMemberRole(organization.id, team.editor.memberId, team.admin.userId, { role: MemberRole.VIEWER });
    expect(demoted.role).toBe(MemberRole.VIEWER);
    const promoted = await members.updateMemberRole(organization.id, team.viewer.memberId, team.admin.userId, { role: MemberRole.MEMBER });
    expect(promoted.role).toBe(MemberRole.MEMBER);
  });

  it('never lets a Viewer manage the team', async () => {
    const { organization, team } = await site();
    await expect(
      members.inviteMember(
        organization.id,
        team.viewer.userId,
        MemberRole.VIEWER,
        { email: `escalate-${randomUUID()}@nibleaf.test`, role: MemberRole.MEMBER },
        { sendEmail: false },
      ),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    await expect(
      members.updateMemberRole(organization.id, team.viewer.memberId, team.viewer.userId, { role: MemberRole.ADMIN }),
    ).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    await expect(
      members.updateMemberRole(organization.id, team.editor.memberId, team.viewer.userId, { role: MemberRole.VIEWER }),
    ).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    await expect(members.removeMember(organization.id, team.editor.memberId, team.viewer.userId)).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });
    const roles = await db.prisma.member.findMany({ where: { organizationId: organization.id }, select: { role: true } });
    expect(roles.map(({ role }) => role).sort()).toEqual([MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.OWNER, MemberRole.VIEWER].sort());
  });

  it('keeps the single-owner rule: a Viewer can never be invited or promoted to owner', async () => {
    const { organization, team } = await site();
    await expect(
      members.updateMemberRole(organization.id, team.viewer.memberId, team.owner.userId, { role: MemberRole.OWNER as never }),
    ).rejects.toMatchObject({ code: 'auth:insufficient_role' });
    await expect(members.transferOwnership(organization.id, team.owner.userId, team.viewer.memberId)).rejects.toMatchObject({
      code: 'database:conflict',
    });
  });
});
