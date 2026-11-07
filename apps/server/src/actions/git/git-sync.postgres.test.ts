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
// One-way import source: public GitHub files served from memory.
const publicRepo = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('../importers/github', () => ({
  listGitHubFiles: async () => [...publicRepo.files.keys()].map((path) => ({ path, type: 'blob' as const })),
  getGitHubTextFile: async (_owner: string, _repo: string, _branch: string, path: string) => publicRepo.files.get(path) ?? null,
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
  let deployments: typeof import('../deployments');
  let branches: typeof import('../branches');
  let gitImport: typeof import('../git-import');
  let persistence: typeof import('../importers/persistence');
  let starterContent: typeof import('@nibleaf/auth/starter-content');
  const organizationIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    apply = await import('./apply');
    workflow = await import('./workflow');
    pages = await import('../pages');
    content = await import('../importers/content');
    deployments = await import('../deployments');
    branches = await import('../branches');
    gitImport = await import('../git-import');
    persistence = await import('../importers/persistence');
    starterContent = await import('@nibleaf/auth/starter-content');
    // Loading the whole server action graph cold can take longer than the
    // default hook timeout on a busy machine.
  }, 120_000);
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
  const conflictPaths = (error: unknown) => (error instanceof apply.GitApplyConflictError ? error.paths : error);
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
  }, 60_000);

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

    expect(conflictPaths(await sync)).toEqual(['about.mdx']);
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Saved by the writer');
  }, 60_000);

  it('never deletes sub-pages with their parent unless Git deleted them too, unchanged', async () => {
    // Git deletes only the parent's file: the parent becomes their folder in place.
    let setup = await fixture();
    let parent = await setup.createPage({ title: 'Guide', slug: 'guide' });
    let child = await setup.createPage({ title: 'Setup', slug: 'setup', parentId: parent.id, path: 'guide/setup' });
    await runApply(await observe(setup), [{ type: 'delete', path: 'guide.mdx', pageId: parent.id }]);
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ kind: 'GROUP', content: '', path: 'guide' });
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({
      kind: 'PAGE',
      parentId: parent.id,
      path: 'guide/setup',
    });

    // Git deletes both, but the child was saved after the merge read: nothing changes.
    setup = await fixture();
    parent = await setup.createPage({ title: 'Guide', slug: 'guide' });
    child = await setup.createPage({ title: 'Setup', slug: 'setup', parentId: parent.id, path: 'guide/setup' });
    const stale = await observe(setup);
    await db.prisma.page.update({ where: { id: child.id }, data: { content: 'Saved by the writer' } });
    const failure = await runApply(stale, [
      { type: 'delete', path: 'guide.mdx', pageId: parent.id },
      { type: 'delete', path: 'guide/setup.mdx', pageId: child.id },
    ]).catch((error: unknown) => error);
    expect(conflictPaths(failure)).toEqual(['guide/setup.mdx']);
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ kind: 'PAGE', content: 'Guide' });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: child.id } })).content).toBe('Saved by the writer');

    // Git deletes both and neither changed: the cascade is safe.
    await runApply(await observe(setup), [
      { type: 'delete', path: 'guide.mdx', pageId: parent.id },
      { type: 'delete', path: 'guide/setup.mdx', pageId: child.id },
    ]);
    expect(await db.prisma.page.count({ where: { id: { in: [parent.id, child.id] } } })).toBe(0);
  }, 60_000);

  it('keeps one import source per path, outside page settings, and drops it with its page', async () => {
    const setup = await fixture();
    const scope = { projectId: setup.project.id, branchId: setup.branch.id, languageId: setup.language.id };
    const page = await setup.createPage({ title: 'Intro', slug: 'intro', content: 'Hello' });
    const other = await setup.createPage({ title: 'Other', slug: 'other' });
    await db.prisma.pageGitImportSource.create({ data: { ...scope, pageId: page.id, path: 'docs/intro.md' } });

    // A path maps to exactly one page per branch/language.
    await expect(db.prisma.pageGitImportSource.create({ data: { ...scope, pageId: other.id, path: 'docs/intro.md' } })).rejects.toMatchObject({
      code: 'P2002',
    });

    // Page settings clearing every override, and a sidebar title plus rename, leave it alone.
    await pages.updatePage(setup.project.id, page.id, { config: null });
    await pages.updatePage(setup.project.id, page.id, { config: { sidebarTitle: 'Start' } });
    await pages.updatePage(setup.project.id, page.id, { title: 'Introduction', config: { sidebarTitle: 'Start' } });
    expect(await db.prisma.pageGitImportSource.findUnique({ where: { pageId: page.id } })).toMatchObject({ path: 'docs/intro.md' });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).config).toEqual({ sidebarTitle: 'Start' });

    // The published snapshot never carries the repository path.
    expect(JSON.stringify(await deployments.getCurrentSnapshot(setup.project.id))).not.toContain('docs/intro.md');

    // Deleting the page deletes its source.
    await db.prisma.page.delete({ where: { id: page.id } });
    expect(await db.prisma.pageGitImportSource.count({ where: { pageId: page.id } })).toBe(0);
  }, 60_000);

  it('never writes a page of the synced language that the merge did not read', async () => {
    const setup = await fixture();
    const context = await observe(setup);
    // A writer creates the page after the merge read the tree.
    const page = await setup.createPage({ title: 'Intro', slug: 'intro', content: 'Written by a writer' });

    const failure = await runApply(context, [
      { type: 'write', path: 'intro.mdx', pageId: page.id, content: '---\ntitle: "Intro"\n---\n\nFrom Git' },
    ]).catch((error: unknown) => error);

    expect(conflictPaths(failure)).toEqual(['intro.mdx']);
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Written by a writer');
  }, 60_000);

  it('gives up the starter cleanup after the lock timeout and keeps the page', async () => {
    const setup = await fixture();
    const page = await db.prisma.page.create({
      data: {
        projectId: setup.project.id,
        branchId: setup.branch.id,
        languageId: setup.language.id,
        title: starterContent.STARTER_GETTING_STARTED_TITLE,
        icon: starterContent.STARTER_GETTING_STARTED_ICON,
        slug: 'getting-started',
        path: 'getting-started',
        content: starterContent.STARTER_GETTING_STARTED_CONTENT,
      },
    });
    let release: () => void = () => undefined;
    let held: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      held = resolve;
    });
    // A long structural write (a Git sync) holds the project lock.
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "project" WHERE "id" = ${setup.project.id} FOR NO KEY UPDATE`;
        held();
        await gate;
      },
      { timeout: 45_000 },
    );
    await locked;
    const started = performance.now();
    try {
      await expect(
        persistence.removeImportPlaceholders({ projectId: setup.project.id, branchId: setup.branch.id, languageId: setup.language.id }),
      ).resolves.toBe(0);
    } finally {
      release();
      await holder;
    }
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThan(9000);
    expect(waited).toBeLessThan(20_000);
    expect(await db.prisma.page.count({ where: { id: page.id } })).toBe(1);
  }, 60_000);

  it('copies one import identity per path when the source branch also holds a stale row for it', async () => {
    const setup = await fixture();
    const current = await setup.createPage({ title: 'Intro', slug: 'intro' });
    const moved = await setup.createPage({ title: 'Intro copy', slug: 'intro-copy' });
    const scope = { projectId: setup.project.id, languageId: setup.language.id, path: 'docs/intro.md' };
    await db.prisma.pageGitImportSource.create({ data: { ...scope, pageId: current.id, branchId: setup.branch.id } });
    // A page merged in from another branch before any re-import repaired its row.
    await db.prisma.pageGitImportSource.create({ data: { ...scope, pageId: moved.id, branchId: `merged-${randomUUID()}` } });

    const version = await branches.createBranch(setup.project.id, { name: `version-${randomUUID()}` });

    const copied = await db.prisma.pageGitImportSource.findMany({ where: { branchId: version.id }, include: { page: { select: { slug: true } } } });
    expect(copied.map((row) => [row.page.slug, row.path])).toEqual([['intro', 'docs/intro.md']]);
  }, 60_000);

  it('keeps a starter page an autosave commits while the import cleanup waits for it', async () => {
    const setup = await fixture();
    const page = await db.prisma.page.create({
      data: {
        projectId: setup.project.id,
        branchId: setup.branch.id,
        languageId: setup.language.id,
        title: starterContent.STARTER_GETTING_STARTED_TITLE,
        icon: starterContent.STARTER_GETTING_STARTED_ICON,
        slug: 'getting-started',
        path: 'getting-started',
        content: starterContent.STARTER_GETTING_STARTED_CONTENT,
      },
    });
    let release: () => void = () => undefined;
    let held: (pid: number) => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holderPid = new Promise<number>((resolve) => {
      held = resolve;
    });
    // A content-only autosave holds just this page row (protocol rule 4).
    const save = db.prisma.$transaction(
      async (tx) => {
        await tx.page.update({ where: { id: page.id }, data: { content: `${starterContent.STARTER_GETTING_STARTED_CONTENT}\n\nOur product.` } });
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        held(backend?.pid ?? 0);
        await gate;
      },
      { timeout: 15_000 },
    );
    const pid = await holderPid;
    const cleanup = persistence.removeImportPlaceholders({ projectId: setup.project.id, branchId: setup.branch.id, languageId: setup.language.id });
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

    await expect(cleanup).resolves.toBe(0);
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toContain('Our product.');
  }, 60_000);

  it('keeps a renamed imported page linked after a preserving import replaces the draft', async () => {
    const setup = await fixture();
    await db.prisma.organization.update({
      where: { id: setup.project.organizationId },
      data: { metadata: JSON.stringify({ git: { provider: 'github', repo: 'acme/docs', branch: 'main', path: 'docs' } }) },
    });
    publicRepo.files = new Map([['docs/intro.md', '# Intro\n\nfirst text']]);
    await expect(gitImport.importFromGitProvider(setup.project.organizationId, setup.project.id)).resolves.toMatchObject({ imported: 1 });
    const imported = await db.prisma.page.findFirstOrThrow({ where: { projectId: setup.project.id, kind: 'PAGE', slug: 'intro' } });
    await db.prisma.page.update({ where: { id: imported.id }, data: { title: 'Overview', slug: 'overview', path: 'overview' } });

    // A default (preserving) GitBook-style import: copy the draft, then promote the copy.
    const replacement = await branches.createImportReplacementBranch(setup.project.id, 'gitbook', true);
    const copied = await db.prisma.page.findFirstOrThrow({ where: { projectId: setup.project.id, branchId: replacement.id, slug: 'overview' } });
    expect(await db.prisma.pageGitImportSource.findUnique({ where: { pageId: copied.id } })).toMatchObject({
      branchId: replacement.id,
      path: 'docs/intro.md',
    });
    await branches.promoteImportReplacementBranch(setup.project.id, replacement.id);

    publicRepo.files = new Map([['docs/intro.md', '# Intro\n\nsecond text']]);
    await expect(gitImport.importFromGitProvider(setup.project.organizationId, setup.project.id)).resolves.toMatchObject({
      imported: 0,
      updated: 1,
      skipped: 0,
    });
    const pagesAfter = await db.prisma.page.findMany({ where: { projectId: setup.project.id, kind: 'PAGE' } });
    expect(pagesAfter.map((page) => [page.id, page.slug])).toEqual([[copied.id, 'overview']]);
    expect(pagesAfter[0]?.content).toContain('second text');
    expect(await db.prisma.pageGitImportSource.findUniqueOrThrow({ where: { pageId: copied.id } })).toMatchObject({ branchId: setup.branch.id });
  }, 60_000);

  it('keeps an imported page linked to its file after its branch is merged into main', async () => {
    const setup = await fixture();
    // A real version, with a fork point: Promote refuses a branch without one.
    const draft = await branches.createBranch(setup.project.id, { name: `draft-${randomUUID()}` });
    const page = await db.prisma.page.create({
      data: {
        projectId: setup.project.id,
        branchId: draft.id,
        languageId: setup.language.id,
        title: 'Intro',
        slug: 'intro',
        path: 'intro',
        content: 'old',
      },
    });
    await db.prisma.pageGitImportSource.create({
      data: { pageId: page.id, projectId: setup.project.id, branchId: draft.id, languageId: setup.language.id, path: 'docs/intro.md' },
    });
    await db.prisma.organization.update({
      where: { id: setup.project.organizationId },
      data: { metadata: JSON.stringify({ git: { provider: 'github', repo: 'acme/docs', branch: 'main', path: 'docs' } }) },
    });

    await branches.mergeBranch(setup.project.id, draft.id);
    publicRepo.files = new Map([['docs/intro.md', '# Intro\n\nnew text']]);
    await expect(gitImport.importFromGitProvider(setup.project.organizationId, setup.project.id)).resolves.toMatchObject({
      imported: 0,
      updated: 1,
      skipped: 0,
    });

    expect(await db.prisma.page.count({ where: { projectId: setup.project.id, kind: 'PAGE' } })).toBe(1);
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toContain('new text');
    expect(await db.prisma.pageGitImportSource.findUniqueOrThrow({ where: { pageId: page.id } })).toMatchObject({
      branchId: setup.branch.id,
      path: 'docs/intro.md',
    });
  }, 60_000);

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
    expect(await db.prisma.page.count({ where: { projectId: setup.project.id, content: { contains: 'v2 body of page-' } } })).toBe(1000);

    const sample = await db.prisma.page.findFirstOrThrow({ where: { projectId: setup.project.id, slug: 'page-0000' } });
    expect(content.serializeGitPage(sample)).toContain('v2 body of page-0000');
    console.info(`[git-sync timing] 1,000 new files: ${Math.round(createMs)} ms; 1,000 upstream edits: ${Math.round(updateMs)} ms`);
    expect(createMs).toBeLessThan(60_000);
    expect(updateMs).toBeLessThan(60_000);
  }, 180_000);
});
