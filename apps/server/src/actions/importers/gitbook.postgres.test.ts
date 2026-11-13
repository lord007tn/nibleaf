import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// #517: one cold start exceeded 60 s and passed on repeat; allow 180 s per test.
describe.skipIf(process.env.GITBOOK_REHEARSAL !== '1')('GitBook with real PostgreSQL and the app', () => {
  let db: typeof import('@nibleaf/database');
  let branches: typeof import('../branches');
  beforeAll(async () => {
    if (process.env.NIBLEAF_IMPORT_LOCAL_ONLY === '1') expect(Reflect.get(globalThis, Symbol.for('nibleaf.import-network-attempts'))).toEqual([]);
    db = await import('@nibleaf/database');
    branches = await import('../branches');
  });
  afterAll(async () => {
    if (process.env.NIBLEAF_IMPORT_LOCAL_ONLY === '1') {
      expect(Reflect.get(globalThis, Symbol.for('nibleaf.import-network-attempts'))).toEqual([]);
      console.info('GitBook worker: outside transport attempts 0; recorded GitHub responses only.');
    }
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
  }, 180_000);

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
  }, 180_000);

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
  }, 180_000);

  /** Import one GitBook folder through the real app route, session and database. */
  const importFolder = async () => {
    const { project, org, main } = await fixture();
    const user = await db.prisma.user.create({ data: { name: 'Synthetic maintainer', email: `${project.id}@example.test`, emailVerified: true } });
    await db.prisma.member.create({ data: { organizationId: org.id, userId: user.id, role: 'owner' } });
    // Importing the route cold can exceed the session's one-minute lifetime.
    const { default: app } = await import('../../routes');
    const token = `synthetic-${randomUUID()}`;
    await db.prisma.session.create({ data: { token, userId: user.id, activeOrganizationId: org.id, expiresAt: new Date(Date.now() + 60_000) } });
    const { keys } = await import('@nibleaf/auth/keys.server');
    const signature = createHmac('sha256', keys().BETTER_AUTH_SECRET).update(token).digest('base64');
    const response = await app.request(`http://localhost:4310/api/app/projects/${project.id}/settings/import/gitbook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` },
      body: JSON.stringify({ repo: `${GITHUB_REPO.owner}/${GITHUB_REPO.name}`, branch: 'main', path: GITHUB_REPO.folder, replaceExisting: true }),
    });
    const result = (await response.json()) as { data: { imported: number } };
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.data.imported).toBe(1);
    const pages = await db.prisma.page.findMany({ where: { projectId: project.id, branchId: main.id } });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.content).toContain('init.lua');
    expect(pages[0]?.content).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Video tour:"></iframe>');
    expect(pages[0]?.content).toContain('\n\n---\n\n');
    expect(pages[0]?.content).not.toContain('\n/\n');
    expect(pages[0]?.content).toContain('[Again](https://nibleaf.com/pages/readme?lang=ar#start)');
    expect(result.data).toMatchObject({
      fidelityIssues: expect.arrayContaining([{ kind: 'link', page: 'readme.md', reference: 'https://nibleaf.com/pages/readme?lang=ar#start' }]),
    });
    expect(await db.prisma.branch.count({ where: { projectId: project.id, isDefault: false } })).toBe(0);
  };

  // CI never calls GitHub: unauthenticated API requests share a 60-an-hour limit
  // per runner address, so a live import fails at random. GitHub's answers for
  // this folder are served locally (the same requests the importer makes: the
  // commit, the recursive tree, raw files); the route, importer and database are real.
  it('imports a GitBook folder from GitHub through the authenticated app route', async () => {
    const githubRequests: Array<{ host: string; path: string }> = [];
    const unexpectedHttpRequests: string[] = [];
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === 'api.github.com' || url.hostname === 'raw.githubusercontent.com') {
        githubRequests.push({ host: url.hostname, path: url.pathname });
        return recordedGitHub(url);
      }
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return realFetch(input, init);
      unexpectedHttpRequests.push(`${url.origin}${url.pathname}`);
      throw new Error(`Unexpected HTTP request in recorded GitBook rehearsal: ${url.origin}${url.pathname}`);
    });
    try {
      await importFolder();
    } finally {
      fetchSpy.mockRestore();
      expect(unexpectedHttpRequests).toEqual([]);
    }
    // The importer took the same path as against GitHub: a commit, its tree, then the page.
    const requested = githubRequests.map(({ host, path }) => `${host}${path}`);
    expect(requested).toEqual([
      `api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/commits/main`,
      `api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/git/trees/${GITHUB_REPO.commit}`,
      ...githubRequests.filter(({ host }) => host === 'raw.githubusercontent.com').map(({ host, path }) => `${host}${path}`),
    ]);
    expect(requested).toContain(
      `raw.githubusercontent.com/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/${GITHUB_REPO.commit}/${GITHUB_REPO.folder}/readme.md`,
    );
    console.info('Authenticated app -> recorded GitHub commit snapshot -> 1 page -> PostgreSQL promotion; no network');
  }, 180_000);

  // The same import against GitHub itself, for a manual check: GITBOOK_LIVE=1.
  it.runIf(process.env.GITBOOK_LIVE === '1')('imports the same folder from live GitHub (manual)', importFolder, 180_000);
});

/** A public repository's folder, as GitHub answered for it at one commit. The
 *  paths and commit are real; the page text is our own. */
const GITHUB_REPO = {
  owner: 'CDPR-Modding-Documentation',
  name: 'Cyberpunk-Modding-Docs',
  commit: 'c431877dd3fe3eb1be627733dc0b12bedc779ec7',
  folder: '_example_mods_and_templates/cyber_engine_tweaks',
};
const RECORDED_TREE = [
  { path: '.gitbook', type: 'tree' },
  { path: '.gitignore', type: 'blob' },
  { path: 'README.md', type: 'blob' },
  { path: 'SUMMARY.md', type: 'blob' },
  { path: '_example_mods_and_templates', type: 'tree' },
  { path: GITHUB_REPO.folder, type: 'tree' },
  { path: `${GITHUB_REPO.folder}/readme.md`, type: 'blob' },
  { path: `${GITHUB_REPO.folder}/tutorial_mod`, type: 'tree' },
  { path: `${GITHUB_REPO.folder}/tutorial_mod/init.lua`, type: 'blob' },
];
const RECORDED_FILES: Record<string, string> = {
  [`${GITHUB_REPO.folder}/readme.md`]:
    '# Cyber Engine Tweaks\n\nA starting point for a script mod. The entry file is `tutorial_mod/init.lua`; copy the folder and rename it to begin.\n\nVideo tour:\n\n{% embed url="https://youtu.be/abcdefghijk" %}\n\n/\n\n<p>---</p>\n\n[Again](https://nibleaf.com/pages/readme?lang=ar#start)\n',
  [`${GITHUB_REPO.folder}/tutorial_mod/init.lua`]: 'registerForEvent("onInit", function() print("ready") end)\n',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** GitHub's answers for {@link GITHUB_REPO}; anything else is a 404, as on GitHub. */
function recordedGitHub(url: URL): Response {
  const repoPath = `/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.name}`;
  if (url.hostname === 'api.github.com') {
    if (url.pathname === `${repoPath}/commits/main`) return json({ sha: GITHUB_REPO.commit });
    if (url.pathname === `${repoPath}/git/trees/${GITHUB_REPO.commit}`)
      return json({
        sha: GITHUB_REPO.commit,
        truncated: false,
        tree: RECORDED_TREE.map((entry) => ({ ...entry, mode: entry.type === 'tree' ? '040000' : '100644' })),
      });
    if (url.pathname === repoPath) return json({ default_branch: 'main' });
    return json({ message: 'Not Found' }, 404);
  }
  const prefix = `/${GITHUB_REPO.owner}/${GITHUB_REPO.name}/${GITHUB_REPO.commit}/`;
  const file = url.pathname.startsWith(prefix) ? RECORDED_FILES[decodeURIComponent(url.pathname.slice(prefix.length))] : undefined;
  return file === undefined
    ? new Response('404: Not Found', { status: 404 })
    : new Response(file, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
