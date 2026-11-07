import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The provider, credential crypto and queue are the only fakes: pages, the
// file ledger, locks, cascades and transactions are real PostgreSQL.
const remote = vi.hoisted(() => ({ files: [] as Array<{ path: string; sha: string; content: string }> }));
vi.mock('@nibleaf/bullmq', () => ({
  createJob: vi.fn(),
  QueueNames: { GIT: 'git' },
  QUEUE_CONFIGS: { git: { operationClaimTimeout: 12 * 60 * 1000 } },
}));
vi.mock('./crypto', () => ({ decryptGitSecret: () => 'token', encryptGitSecret: (value: string) => value, gitCredentialFingerprint: () => 'fp' }));
vi.mock('./github', () => ({
  GitHubProvider: class {
    getBranchSha = async (_repository: string, branch: string) => (branch === 'main' ? 'base-sha' : 'head-sha');
    listThemeRepositoryFiles = async () => remote.files;
    listMarkdownFiles = async () => remote.files;
  },
}));

// Opt in only against a migrated scratch database. Fixtures are synthetic and
// cleanup is restricted to the exact organizations this suite creates.
describe.skipIf(process.env.DATA_INTEGRITY_POSTGRES !== '1')('Git sync apply in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let apply: typeof import('./apply');
  let workflow: typeof import('./workflow');
  let pages: typeof import('../pages');
  let content: typeof import('../importers/content');
  const organizationIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    apply = await import('./apply');
    workflow = await import('./workflow');
    pages = await import('../pages');
    content = await import('../importers/content');
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async () => {
    const id = `git-sync-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const createPage = (fields: { title: string; slug: string; parentId?: string | null; path?: string; content?: string; position?: number }) =>
      db.prisma.page.create({
        data: {
          projectId: project.id,
          branchId: branch.id,
          languageId: language.id,
          parentId: fields.parentId ?? null,
          title: fields.title,
          slug: fields.slug,
          path: fields.path ?? fields.slug,
          content: fields.content ?? fields.title,
          position: fields.position ?? 0,
        },
      });
    return { project, branch, language, createPage };
  };

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const observe = async ({ project, branch, language }: Fixture) => {
    const rows = await db.prisma.page.findMany({
      where: { projectId: project.id, branchId: branch.id, languageId: language.id },
      select: { id: true, parentId: true, kind: true, updatedAt: true, title: true, content: true, description: true, icon: true },
    });
    return {
      projectId: project.id,
      contentPath: '',
      branch: { id: branch.id, name: branch.name },
      language: { id: language.id, code: language.code },
      snapshot: { project: { versions: [], languages: [] }, pages: [], generatedAt: '' } as never,
      observed: new Map(rows.map((row) => [row.id, row])),
    };
  };
  const runApply = (context: Awaited<ReturnType<typeof observe>>, changes: import('./apply').GitContentChange[]) =>
    db.prisma.$transaction((tx) => apply.applyGitContentChanges(tx, context, changes), { timeout: 15_000 });
  const conflictReasons = (error: unknown) => (error instanceof apply.GitApplyConflictError ? error.conflicts.map((c) => c.reason) : error);
  const isDeadlock = (error: unknown) => /40P01|deadlock/i.test(`${(error as { code?: string })?.code ?? ''} ${String(error)}`);

  it('never deadlocks an updates-only sync against a reorder of the same pages', async () => {
    const setup = await fixture();
    const first = await setup.createPage({ title: 'First', slug: 'first', position: 0 });
    const second = await setup.createPage({ title: 'Second', slug: 'second', position: 1 });
    const failures: unknown[] = [];
    for (let round = 0; round < 25; round++) {
      const context = await observe(setup);
      const order = round % 2 === 0 ? [second, first] : [first, second];
      const results = await Promise.allSettled([
        runApply(context, [
          { type: 'write', path: 'first.mdx', pageId: first.id, content: `---\ntitle: "First"\n---\n\nround ${round}` },
          { type: 'write', path: 'second.mdx', pageId: second.id, content: `---\ntitle: "Second"\n---\n\nround ${round}` },
        ]),
        pages.reorderPages(setup.project.id, { items: order.map((page, position) => ({ id: page.id, parentId: null, position })) }),
      ]);
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    }
    // A reorder that commits first legitimately turns the sync into a revision
    // conflict; what must never happen is a deadlock abort.
    expect(failures.filter(isDeadlock)).toEqual([]);
    expect(failures.every((error) => error instanceof apply.GitApplyConflictError)).toBe(true);
  });

  it('turns a dashboard save that commits while the conditional write waits into a conflict', async () => {
    const setup = await fixture();
    const page = await setup.createPage({ title: 'About', slug: 'about', content: 'Original' });
    const context = await observe(setup);

    let release: () => void = () => undefined;
    let held: (pid: number) => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holderPid = new Promise<number>((resolve) => {
      held = resolve;
    });
    // A content-only dashboard save: it locks only this page row (protocol rule 4).
    const save = db.prisma.$transaction(
      async (tx) => {
        await tx.page.update({ where: { id: page.id }, data: { content: 'Saved by the writer' } });
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        held(backend?.pid ?? 0);
        await gate;
      },
      { timeout: 15_000 },
    );
    const pid = await holderPid;
    const sync = runApply(context, [{ type: 'write', path: 'about.mdx', pageId: page.id, content: '---\ntitle: "About"\n---\n\nFrom Git' }]).then(
      () => null,
      (error: unknown) => error,
    );
    let waiting = 0;
    for (let attempt = 0; attempt < 200 && waiting === 0; attempt++) {
      const [row] = await db.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND ${pid} = ANY(pg_blocking_pids(pid))`;
      waiting = row?.count ?? 0;
      if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(1);
    release();
    await save;

    expect(conflictReasons(await sync)).toEqual(['edited']);
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Saved by the writer');
  });

  it('protects descendants from a cascading delete', async () => {
    const setup = await fixture();
    const parent = await setup.createPage({ title: 'Guide', slug: 'guide' });
    const child = await setup.createPage({ title: 'Setup', slug: 'setup', parentId: parent.id, path: 'guide/setup' });
    const remaining = () => db.prisma.page.count({ where: { id: { in: [parent.id, child.id] } } });

    // Git deleted only the parent: deleting it would cascade into a child Git still has.
    let failure = await runApply(await observe(setup), [{ type: 'delete', path: 'guide.mdx', pageId: parent.id, resolved: false }]).catch((e) => e);
    expect(conflictReasons(failure)).toEqual(['subtree']);
    expect(await remaining()).toBe(2);

    // The child is saved after the merge read: even an explicitly resolved delete stops.
    const stale = await observe(setup);
    await db.prisma.page.update({ where: { id: child.id }, data: { content: 'Saved by the writer' } });
    failure = await runApply(stale, [{ type: 'delete', path: 'guide.mdx', pageId: parent.id, resolved: true }]).catch((e) => e);
    expect(conflictReasons(failure)).toEqual(['subtree']);
    expect(await remaining()).toBe(2);

    // An explicit choice over an unchanged subtree goes through.
    await runApply(await observe(setup), [{ type: 'delete', path: 'guide.mdx', pageId: parent.id, resolved: true }]);
    expect(await remaining()).toBe(0);
  });

  it('applies a 1,000-file sync well inside the transaction limit', async () => {
    const setup = await fixture();
    const connection = await db.prisma.gitConnection.create({
      data: {
        projectId: setup.project.id,
        repository: 'acme/docs',
        headBranch: 'nibleaf/docs',
        credentialEncrypted: 'token',
        createdById: 'synthetic',
      },
    });
    const pull = async (key: string) => {
      const operation = await db.prisma.gitSyncOperation.create({
        data: { connectionId: connection.id, kind: 'PULL', idempotencyKey: key, requestHash: key, baseBranch: 'main', headBranch: 'nibleaf/docs' },
      });
      const started = performance.now();
      await workflow.processGitOperation(operation.id);
      return performance.now() - started;
    };
    const files = (version: string) =>
      Array.from({ length: 1000 }, (_, index) => {
        const name = `page-${String(index).padStart(4, '0')}`;
        return { path: `${name}.mdx`, sha: `${name}-${version}`, content: `---\ntitle: "${name}"\n---\n\n${version} body of ${name}` };
      });

    remote.files = files('v1');
    const createMs = await pull(`create-${randomUUID()}`);
    expect(await db.prisma.page.count({ where: { projectId: setup.project.id, kind: 'PAGE' } })).toBe(1000);
    expect(await db.prisma.gitFileState.count({ where: { connectionId: connection.id, pageId: { not: null } } })).toBe(1000);

    remote.files = files('v2');
    const updateMs = await pull(`update-${randomUUID()}`);
    expect(await db.prisma.page.count({ where: { projectId: setup.project.id, content: { startsWith: 'v2 body' } } })).toBe(1000);

    const sample = await db.prisma.page.findFirstOrThrow({ where: { projectId: setup.project.id, slug: 'page-0000' } });
    expect(content.serializeGitPage(sample)).toContain('v2 body of page-0000');
    console.info(`[git-sync timing] 1,000 new files: ${Math.round(createMs)} ms; 1,000 upstream edits: ${Math.round(updateMs)} ms`);
    expect(createMs).toBeLessThan(60_000);
    expect(updateMs).toBeLessThan(60_000);
  }, 180_000);
});
