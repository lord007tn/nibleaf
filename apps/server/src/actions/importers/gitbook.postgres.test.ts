import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf(process.env.GITBOOK_REHEARSAL !== '1')('GitBook with real PostgreSQL and the app', () => {
  let db: typeof import('@nibleaf/database');
  let branches: typeof import('../branches');
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    branches = await import('../branches');
  });
  afterAll(async () => {
    await db?.prisma.$disconnect();
  });

  const fixture = async () => {
    const id = `gitbook-rehearsal-${randomUUID()}`;
    const org = await db.prisma.organization.create({ data: { name: 'Synthetic import rehearsal' } });
    const project = await db.prisma.project.create({ data: { id, organizationId: org.id, name: 'Synthetic import rehearsal', slug: id } });
    const main = await db.prisma.branch.create({ data: { projectId: id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: id, code: 'en', label: 'English', isDefault: true } });
    const page = await db.prisma.page.create({
      data: {
        projectId: id,
        branchId: main.id,
        languageId: language.id,
        title: 'Original',
        slug: 'original',
        path: 'original',
        content: 'Original content',
      },
    });
    return { project, org, main, language, page };
  };

  it('rejects a changed draft and preserves its edited content', async () => {
    const { project, page } = await fixture();
    const fingerprint = await branches.captureImportDraft(project.id);
    const replacement = await branches.createImportReplacementBranch(project.id, 'gitbook', true);
    await db.prisma.page.update({ where: { id: page.id }, data: { content: 'Concurrent edit' } });
    await expect(branches.promoteImportReplacementBranch(project.id, replacement.id, undefined, fingerprint)).rejects.toMatchObject({ status: 409 });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Concurrent edit');
    expect(await db.prisma.branch.findUnique({ where: { id: replacement.id } })).not.toBeNull();
    console.info('Snapshot conflict: 409, edited draft and replacement retained');
  });

  it('maps a real PostgreSQL 40001 through adapter-pg to P2034', async () => {
    const { page } = await fixture();
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const read = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = db.prisma.$transaction(
      async (tx) => {
        await tx.page.findUniqueOrThrow({ where: { id: page.id } });
        entered();
        await gate;
        await tx.page.update({ where: { id: page.id }, data: { content: 'Stale writer' } });
      },
      { isolationLevel: 'Serializable', timeout: 30_000 },
    );
    const outcome = transaction.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await read;
      await db.prisma.page.update({ where: { id: page.id }, data: { content: 'Committed writer' } });
    } finally {
      release();
    }
    expect(await outcome).toMatchObject({ code: 'P2034' });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Committed writer');
    console.info('Serializable adapter receipt: concurrent update -> P2034; committed writer retained');
  });

  it('rejects a promotion racing with an edit after its fingerprint read', async () => {
    const { project, page } = await fixture();
    const fingerprint = await branches.captureImportDraft(project.id);
    const replacement = await branches.createImportReplacementBranch(project.id, 'gitbook', true);
    // Hold the row while the promotion reads its snapshot and reaches DELETE.
    let held: () => void = () => undefined;
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const editor = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM page WHERE id = ${page.id} FOR UPDATE`;
        held();
        await gate;
        await tx.page.update({ where: { id: page.id }, data: { content: 'Edit while promoting' } });
      },
      { timeout: 30_000 },
    );
    await ready;
    const promotion = branches.promoteImportReplacementBranch(project.id, replacement.id, undefined, fingerprint);
    const outcome = promotion.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await db.prisma.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%DELETE%page%') AS waiting`;
        if (rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await editor;
    }
    expect(await outcome).toMatchObject({ status: 409 });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Edit while promoting');
    expect(await db.prisma.branch.findUnique({ where: { id: replacement.id } })).not.toBeNull();
    console.info('Promotion race: real blocking DELETE -> serialization rejection -> HTTP 409; edit preserved');
  });

  it('imports a real public GitBook folder through the authenticated app route', async () => {
    const { project, org, main } = await fixture();
    const user = await db.prisma.user.create({ data: { name: 'Synthetic maintainer', email: `${project.id}@example.test`, emailVerified: true } });
    await db.prisma.member.create({ data: { organizationId: org.id, userId: user.id, role: 'owner' } });
    const token = `synthetic-${randomUUID()}`;
    await db.prisma.session.create({ data: { token, userId: user.id, activeOrganizationId: org.id, expiresAt: new Date(Date.now() + 60_000) } });
    const { keys } = await import('@nibleaf/auth/keys.server');
    const signature = createHmac('sha256', keys().BETTER_AUTH_SECRET).update(token).digest('base64');
    const { default: app } = await import('../../routes');
    const response = await app.request(`http://localhost:4310/api/app/projects/${project.id}/settings/import/gitbook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` },
      body: JSON.stringify({
        repo: 'CDPR-Modding-Documentation/Cyberpunk-Modding-Docs',
        branch: 'main',
        path: '_example_mods_and_templates/cyber_engine_tweaks',
        replaceExisting: true,
      }),
    });
    const result = (await response.json()) as { data: { imported: number } };
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.data.imported).toBe(1);
    const pages = await db.prisma.page.findMany({ where: { projectId: project.id, branchId: main.id } });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toContain('init.lua');
    expect(await db.prisma.branch.count({ where: { projectId: project.id, isDefault: false } })).toBe(0);
    console.info('Authenticated app -> GitHub commit snapshot -> 1 public page -> PostgreSQL promotion; no assets or third-party images');
  }, 60_000);
});
