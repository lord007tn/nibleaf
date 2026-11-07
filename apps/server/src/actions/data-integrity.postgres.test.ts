import { randomUUID } from 'node:crypto';
import type { Member, Prisma } from '@nibleaf/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Opt in only against a migrated test database. Every fixture is synthetic and
// cleanup is restricted to the exact IDs created by this suite.
describe.skipIf(process.env.DATA_INTEGRITY_POSTGRES !== '1')('action data integrity in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let pages: typeof import('./pages');
  let languages: typeof import('./languages');
  let members: typeof import('./members');
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    pages = await import('./pages');
    languages = await import('./languages');
    members = await import('./members');
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async () => {
    const id = `integrity-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    return { organization, project, branch, language };
  };

  /** Start both requests while their real PostgreSQL lock is held. Observing
   * blocked backends proves the actions actually serialize before their reads. */
  const whileLocked = async <T>(lock: (tx: Prisma.TransactionClient) => Promise<unknown>, requests: () => Promise<T>[]) => {
    let release: () => void = () => undefined;
    let held: (pid: number) => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<number>((resolve) => {
      held = resolve;
    });
    const holder = db.prisma.$transaction(
      async (tx) => {
        await lock(tx);
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        if (!backend) throw new Error('Missing PostgreSQL backend');
        held(backend.pid);
        await gate;
      },
      { timeout: 15_000 },
    );
    const pid = await Promise.race([
      acquired,
      holder.then(() => {
        throw new Error('Lock holder exited early');
      }),
    ]);
    const pending = requests();
    const outcomes = Promise.allSettled(pending);
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await db.prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND ${pid} = ANY(pg_blocking_pids(pid))`;
        waiting = row?.count ?? 0;
        if (waiting >= pending.length) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThanOrEqual(pending.length);
    } finally {
      release();
      await holder;
    }
    return outcomes;
  };

  it('merges overlapping language sections after acquiring the project lock', async () => {
    const { project, language } = await fixture();
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR UPDATE`,
      () => [
        languages.updateLanguage(project.id, language.id, { config: { banner: { message: 'Synthetic announcement' } } }),
        languages.updateLanguage(project.id, language.id, { config: { seo: { metaTitle: 'Synthetic documentation' } } }),
      ],
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await db.prisma.language.findUniqueOrThrow({ where: { id: language.id } })).config).toEqual({
      banner: { message: 'Synthetic announcement' },
      seo: { metaTitle: 'Synthetic documentation' },
    });
  });

  const memberFixture = async (legacyOwners = false) => {
    const { organization } = await fixture();
    const rows: Member[] = [];
    for (let index = 0; index < 3; index++) {
      const user = await db.prisma.user.create({ data: { name: 'Synthetic member', email: `integrity-${randomUUID()}@example.invalid` } });
      userIds.push(user.id);
      rows.push(
        await db.prisma.member.create({
          data: { organizationId: organization.id, userId: user.id, role: index === 0 || (legacyOwners && index === 1) ? 'owner' : 'admin' },
        }),
      );
    }
    const [owner, first, second] = rows;
    if (!owner || !first || !second) throw new Error('Missing member fixture');
    return { organization, owner, first, second };
  };

  it('reauthorizes concurrent ownership transfers under the organization lock', async () => {
    const { organization, owner, first, second } = await memberFixture();
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM organization WHERE id = ${organization.id} FOR UPDATE`,
      () => [members.transferOwnership(organization.id, owner.userId, first.id), members.transferOwnership(organization.id, owner.userId, second.id)],
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prisma.member.count({ where: { organizationId: organization.id, role: 'owner' } })).toBe(1);
  });

  it.each(['demote', 'remove'])('keeps a last legacy owner during overlapping %s requests', async (operation) => {
    const { organization, owner, first } = await memberFixture(true);
    const change = (id: string) =>
      operation === 'demote'
        ? members.updateMemberRole(organization.id, id, 'owner', { role: 'admin' })
        : members.removeMember(organization.id, id, 'owner');
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM organization WHERE id = ${organization.id} FOR UPDATE`,
      () => [change(owner.id), change(first.id)],
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prisma.member.count({ where: { organizationId: organization.id, role: 'owner' } })).toBe(1);
  });

  it('rejects the second conflicting move and commits consistent subtree paths', async () => {
    const { project, branch, language } = await fixture();
    const create = (slug: string, parentId: string | null = null) =>
      pages.createPage(project.id, {
        title: slug,
        slug,
        parentId,
        branchId: branch.id,
        languageId: language.id,
      });
    const group = await create('guides');
    const other = await create('other');
    const first = await create('intro');
    const second = await create('intro', other.id);
    const child = await create('child', first.id);
    const move = (id: string) => pages.reorderPages(project.id, { items: [{ id, parentId: group.id, position: 0 }] });
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR UPDATE`,
      () => [move(first.id), move(second.id)],
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rows = await db.prisma.page.findMany({ where: { projectId: project.id } });
    expect(new Set(rows.map((page) => page.path)).size).toBe(rows.length);
    const parent = rows.find((page) => page.id === first.id);
    expect(rows.find((page) => page.id === child.id)?.path).toBe(`${parent?.path}/child`);
  });

  it('allocates distinct slugs for concurrent sibling creation', async () => {
    const { project, branch, language } = await fixture();
    const create = () => pages.createPage(project.id, { title: 'Intro', branchId: branch.id, languageId: language.id });
    const results = await whileLocked(
      (tx) => tx.$queryRaw`SELECT id FROM project WHERE id = ${project.id} FOR UPDATE`,
      () => [create(), create()],
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await db.prisma.page.findMany({ where: { projectId: project.id }, orderBy: { slug: 'asc' } })).map((page) => page.path)).toEqual([
      'intro',
      'intro-2',
    ]);
  });

  it('preserves a URL edit that commits between the content autosave read and write', async () => {
    const { project, branch, language } = await fixture();
    const page = await pages.createPage(project.id, { title: 'Intro', branchId: branch.id, languageId: language.id });
    const results = await whileLocked(
      (tx) => tx.page.update({ where: { id: page.id }, data: { slug: 'start', path: 'start' } }),
      () => [pages.updatePage(project.id, page.id, { content: 'Synthetic autosave' })],
    );
    expect(results[0]?.status).toBe('fulfilled');
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({
      slug: 'start',
      path: 'start',
      content: 'Synthetic autosave',
    });
  });
});
