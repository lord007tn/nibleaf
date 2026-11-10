import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Website erasure queues storage and search jobs; no Redis in this suite.
// No ClickHouse in this suite: erasure's partition deletes are recorded, not sent.
vi.mock('@nibleaf/clickhouse', async (original) => ({
  ...(await original<typeof import('@nibleaf/clickhouse')>()),
  deleteProjectAiConversations: vi.fn(async () => undefined),
  deleteProjectAnalytics: vi.fn(async () => undefined),
  deleteProjectUsage: vi.fn(async () => undefined),
}));
vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
  getJob: vi.fn(async () => undefined),
  removeJob: vi.fn(async () => undefined),
  sendRequiredEmail: vi.fn(async () => undefined),
}))

/**
 * The organization shell's server side (design §5.4) against a real database:
 * switcher data, landing and recent websites, personal preferences, creating
 * and deleting organizations, websites inside an org, and the inbox labels.
 * Run with ORG_SHELL_INTEGRATION=1 and POSTGRES_URL pointing at a migrated DB.
 */
describe.skipIf(process.env.ORG_SHELL_INTEGRATION !== '1')('organization shell on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let me: typeof import('./me');
  let orgs: typeof import('./organizations');
  let projects: typeof import('./projects');
  let notifications: typeof import('./notifications');
  const run = `shell${randomUUID().slice(0, 8)}`;
  const u = [0, 1, 2, 3, 4, 5].map((i) => `${run}-u${i}`);
  const org = { a: `${run}-a`, b: `${run}-b`, c: `${run}-c`, x: `${run}-x` };
  const site = { a1: `${run}-a1`, a2: `${run}-a2`, b1: `${run}-b1`, x1: `${run}-x1` };
  const createdOrgs: string[] = [];
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    me = await import('./me');
    orgs = await import('./organizations');
    projects = await import('./projects');
    notifications = await import('./notifications');
    for (const [i, id] of u.entries())
      await db.prisma.user.create({ data: { id, name: `User ${i}`, email: `${id}@nibleaf.test`, emailVerified: i !== 5 } });
    for (const [i, id] of Object.values(org).entries())
      await db.prisma.organization.create({
        data: { id, name: `Org ${id}`, slug: id, createdAt: at(i), handles: { create: { slug: id, current: true } } },
      });
    await db.prisma.project.create({ data: { id: site.a1, name: 'Zeta docs', slug: site.a1, organizationId: org.a } });
    await db.prisma.project.create({ data: { id: site.a2, name: 'alpha docs', slug: site.a2, organizationId: org.a } });
    await db.prisma.project.create({ data: { id: site.b1, name: 'Bravo', slug: site.b1, organizationId: org.b } });
    await db.prisma.project.create({ data: { id: site.x1, name: 'Hidden', slug: site.x1, organizationId: org.x } });
    const member = (organizationId: string, userId: string, orgRole: string, minute: number) =>
      db.prisma.member.create({ data: { organizationId, userId, orgRole, role: orgRole === 'member' ? 'viewer' : orgRole, createdAt: at(minute) } });
    await member(org.a, u[0] ?? '', 'owner', 0);
    await member(org.a, u[1] ?? '', 'admin', 1);
    await member(org.a, u[2] ?? '', 'member', 2);
    await member(org.b, u[2] ?? '', 'owner', 3);
    await member(org.c, u[2] ?? '', 'member', 4);
    await member(org.x, u[4] ?? '', 'owner', 5);
    await db.prisma.projectMember.create({ data: { organizationId: org.a, projectId: site.a1, userId: u[2] ?? '', role: 'viewer' } });
    await db.prisma.deployment.create({ data: { projectId: site.a1, version: 1, status: 'READY' } }).catch(() => undefined);
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    const userIds = [...u];
    const orgIds = [...Object.values(org), ...createdOrgs];
    await db.prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.prisma.invitation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
  });

  it('lands on the owned org first, then the last opened one, and counts only websites the caller can open', async () => {
    const first = await me.getSwitcher(u[2] ?? '');
    expect(first.organizations.map((o) => [o.id, o.orgRole, o.canCreateWebsite, o.websiteCount])).toEqual([
      [org.a, 'member', false, 1],
      [org.b, 'owner', true, 1],
      [org.c, 'member', false, 0],
    ]);
    expect(first.landing).toEqual({ id: org.b, slug: org.b });
    expect(first.recent).toEqual([]);
  });

  it('records recent websites and the last org only for what the caller can open', async () => {
    await expect(me.recordLastOrganization(u[2] ?? '', { projectId: site.a2 })).rejects.toMatchObject({ status: 404 });
    await expect(me.recordLastOrganization(u[2] ?? '', { organizationId: org.x })).rejects.toMatchObject({ status: 404 });
    await me.recordLastOrganization(u[2] ?? '', { projectId: site.b1 });
    await me.recordLastOrganization(u[2] ?? '', { organizationId: org.c });
    await me.recordLastOrganization(u[2] ?? '', { projectId: site.a1 });
    const switcher = await me.getSwitcher(u[2] ?? '');
    expect(switcher.landing?.id).toBe(org.a);
    expect(switcher.organizations.map((o) => o.id)).toEqual([org.a, org.b, org.c]);
    expect(switcher.recent.map((w) => [w.id, w.organization.id, w.live])).toEqual([
      [site.a1, org.a, true],
      [site.b1, org.b, false],
    ]);
    // Losing the grant hides the website from Recent at once.
    await db.prisma.projectMember.deleteMany({ where: { projectId: site.a1, userId: u[2] ?? '' } });
    expect((await me.getSwitcher(u[2] ?? '')).recent.map((w) => w.id)).toEqual([site.b1]);
    await db.prisma.projectMember.create({ data: { organizationId: org.a, projectId: site.a1, userId: u[2] ?? '', role: 'viewer' } });
  });

  it('lists an org’s websites for the switcher and the Websites page, with the effective role', async () => {
    expect((await projects.listOrganizationSwitcherProjects(u[1] ?? '', org.a)).map((w) => w.name)).toEqual(['alpha docs', 'Zeta docs']);
    const memberView = await projects.listOrganizationProjects(u[2] ?? '', org.a);
    expect(memberView.map((w) => [w.id, w.role])).toEqual([[site.a1, 'viewer']]);
    expect(memberView[0]).toHaveProperty('domain');
    expect((await projects.listOrganizationProjects(u[1] ?? '', org.a)).map((w) => w.role)).toEqual(['admin', 'admin']);
  });

  it('merges personal notification preferences', async () => {
    expect((await me.getPreferences(u[3] ?? '')).notifications.security_login).toBe(true);
    await me.updatePreferences(u[3] ?? '', { notifications: { security_login: false } });
    const after = await me.updatePreferences(u[3] ?? '', { notifications: { project_new: false } });
    expect(after.notifications).toMatchObject({ security_login: false, project_new: false, member_joined: true });
  });

  it('creates an empty organization with a handle from its name, owned by the caller', async () => {
    const created = await orgs.createOrganization(u[3] ?? '', `Acme ${run}`);
    const again = await orgs.createOrganization(u[3] ?? '', `Acme ${run}`);
    const reserved = await orgs.createOrganization(u[3] ?? '', 'Settings');
    const arabic = await orgs.createOrganization(u[3] ?? '', 'مؤسسة سارة');
    createdOrgs.push(created.id, again.id, reserved.id, arabic.id);
    expect(created).toMatchObject({ slug: `acme-${run}`, orgRole: 'owner', canCreateWebsite: true });
    expect(again.slug).toBe(`acme-${run}-2`);
    expect(reserved.slug).toBe(`org-${reserved.id.slice(0, 6)}`);
    // cuids minted together share their prefix, so the second fallback takes a suffix.
    expect(arabic.slug.startsWith(`org-${arabic.id.slice(0, 6)}`)).toBe(true);
    expect(arabic.slug).toMatch(/^org-[a-z0-9]{6}(?:-\d+)?$/);
    expect(await db.prisma.project.count({ where: { organizationId: created.id } })).toBe(0);
    expect(await db.prisma.organizationHandle.findUnique({ where: { slug: created.slug } })).toMatchObject({
      organizationId: created.id,
      current: true,
    });
    expect(await db.prisma.organizationUsagePlan.count({ where: { organizationId: created.id } })).toBe(1);
    expect((await me.getSwitcher(u[3] ?? '')).landing?.id).toBe(arabic.id);
  });

  it('creates websites only inside an org the caller administers, never a new org', async () => {
    const before = await db.prisma.organization.count();
    const website = await projects.createProject(u[1] ?? '', { name: `Admin site ${run}`, organizationId: org.a });
    expect(website.organizationId).toBe(org.a);
    expect(await db.prisma.organization.count()).toBe(before);
    await expect(projects.createProject(u[2] ?? '', { name: 'Nope', organizationId: org.a })).rejects.toMatchObject({ status: 403 });
    await expect(projects.createProject(u[2] ?? '', { name: 'Nope', organizationId: org.x })).rejects.toMatchObject({ status: 404 });
  });

  it('shows administrators to members and stores the invitation-email setting without losing metadata', async () => {
    await db.prisma.organization.update({ where: { id: org.a }, data: { metadata: JSON.stringify({ keep: 1, notifications: { other: false } }) } });
    const seen = await orgs.getOrganization(u[2] ?? '', org.a);
    expect(seen.administrators).toEqual([{ name: 'User 0' }, { name: 'User 1' }]);
    expect(seen.sendInvitationEmails).toBe(true);
    const updated = await orgs.updateOrganization(org.a, u[1] ?? '', { sendInvitationEmails: false });
    expect(updated.sendInvitationEmails).toBe(false);
    const stored = await db.prisma.organization.findUniqueOrThrow({ where: { id: org.a } });
    expect(JSON.parse(stored.metadata ?? '{}')).toEqual({ keep: 1, notifications: { other: false, member_invited: false } });
    await expect(orgs.updateOrganization(org.a, u[1] ?? '', { slug: 'welcome' })).rejects.toMatchObject({ status: 400 });
  });

  it('deletes an organization only for its owner typing the exact name', async () => {
    const doomed = await orgs.createOrganization(u[3] ?? '', `Doomed ${run}`);
    createdOrgs.push(doomed.id);
    await db.prisma.member.create({ data: { organizationId: doomed.id, userId: u[1] ?? '', orgRole: 'admin', role: 'admin' } });
    // Not empty: deletion erases its websites first, then the org.
    const doomedSites = [
      await projects.createProject(u[3] ?? '', { name: `Doomed site 1 ${run}`, organizationId: doomed.id }),
      await projects.createProject(u[3] ?? '', { name: `Doomed site 2 ${run}`, organizationId: doomed.id }),
    ];
    await expect(orgs.deleteOrganization(doomed.id, u[3] ?? '', 'doomed')).rejects.toMatchObject({ status: 400 });
    await expect(orgs.deleteOrganization(doomed.id, u[1] ?? '', doomed.name)).rejects.toMatchObject({ status: 403 });
    await expect(orgs.deleteOrganization(doomed.id, u[3] ?? '', doomed.name)).resolves.toEqual({ id: doomed.id });
    expect(await db.prisma.organization.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await db.prisma.project.count({ where: { id: { in: doomedSites.map((site) => site.id) } } })).toBe(0);
  });

  it('lists pending invitations only for a verified address', async () => {
    for (const userId of [u[4], u[5]])
      await db.prisma.invitation.create({
        data: {
          organizationId: org.a,
          inviterId: u[0] ?? '',
          email: `${userId}@nibleaf.test`.toUpperCase(),
          orgRole: 'member',
          role: 'viewer',
          kind: 'member',
          status: 'pending',
          expiresAt: new Date(Date.now() + 86_400_000),
          grants: { create: [{ projectId: site.a1, role: 'member' }] },
        },
      });
    expect(await me.listMyInvitations(u[4] ?? '')).toEqual([
      expect.objectContaining({
        organization: { name: `Org ${org.a}`, logo: null },
        inviter: { name: 'User 0' },
        grants: [{ projectName: 'Zeta docs', role: 'member' }],
      }),
    ]);
    expect(await me.listMyInvitations(u[5] ?? '')).toEqual([]);
  });

  it('labels inbox items with their org and website and filters by organization', async () => {
    await db.prisma.notification.createMany({
      data: [
        { userId: u[2] ?? '', projectId: site.a1, type: 'deploy', title: 'A' },
        { userId: u[2] ?? '', projectId: site.b1, type: 'deploy', title: 'B' },
        { userId: u[2] ?? '', organizationId: org.b, type: 'member_joined', title: 'Org B' },
        { userId: u[2] ?? '', organizationId: org.c, type: 'member_joined', title: 'Org C (member: hidden)' },
      ],
    });
    const all = await notifications.listNotifications(u[2] ?? '');
    expect(all.items.map((item) => [item.title, item.organization?.id, item.project?.id ?? null]).sort()).toEqual(
      [
        ['A', org.a, site.a1],
        ['B', org.b, site.b1],
        ['Org B', org.b, null],
      ].sort(),
    );
    const onlyB = await notifications.listNotifications(u[2] ?? '', undefined, org.b);
    expect(onlyB.items.map((item) => item.title).sort()).toEqual(['B', 'Org B']);
  });
});
