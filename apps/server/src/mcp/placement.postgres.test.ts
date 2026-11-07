import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Run only through the shared-services wrapper against nibleaf-audit-test.
describe.skipIf(process.env.DATA_INTEGRITY_POSTGRES !== '1')('MCP placement lock protocol in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let place: typeof import('./content-write')['placeAmongSiblings'];
  let organizationId: string | undefined;
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    place = (await import('./content-write')).placeAmongSiblings;
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    try {
      if (organizationId) await db.prisma.organization.delete({ where: { id: organizationId } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  it('waits for the project lock without holding a page lock that blocks autosave', async () => {
    const slug = `mcp-placement-${randomUUID()}`;
    const org = await db.prisma.organization.create({ data: { name: slug } });
    organizationId = org.id;
    const project = await db.prisma.project.create({ data: { organizationId: org.id, name: slug, slug } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const page = await db.prisma.page.create({
      data: { projectId: project.id, branchId: branch.id, languageId: language.id, title: 'Synthetic page', slug: 'page', path: 'page' },
    });
    let held: (pid: number) => void = () => undefined;
    let unlock: () => void = () => undefined;
    const acquired = new Promise<number>((resolve) => {
      held = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "project" WHERE id = ${project.id} FOR NO KEY UPDATE`;
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        if (!row) throw new Error('Missing backend');
        held(row.pid);
        await release;
      },
      { timeout: 15_000 },
    );
    const pid = await Promise.race([
      acquired,
      holder.then(() => {
        throw new Error('Holder exited early');
      }),
    ]);
    const placement = place(project.id, page, 0);
    const outcome = placement.then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await db.prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (row?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await db.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
        await tx.page.update({ where: { id: page.id }, data: { content: 'Concurrent content save' } });
      });
    } finally {
      unlock();
      await holder;
    }
    expect(await outcome).toMatchObject({ ok: true });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Concurrent content save');
  }, 30_000);
});
