import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const source = vi.hoisted(() => ({ files: new Map<string, string>(), beforeRead: async () => undefined }));
vi.mock('./github', () => ({
  getGitHubDefaultBranch: async () => 'main',
  getGitHubSnapshot: async () => ({ revision: 'pinned-source', files: [...source.files.keys()].map((path) => ({ path, type: 'blob' })) }),
  getGitHubTextFile: async (_owner: string, _repo: string, ref: string, path: string) => {
    expect(ref).toBe('pinned-source');
    await source.beforeRead();
    return source.files.get(path) ?? null;
  },
  githubRawUrl: (_owner: string, _repo: string, ref: string, path: string) => `https://raw.githubusercontent.com/synthetic/docs/${ref}/${path}`,
}));

describe.skipIf(process.env.IMPORT_REHEARSAL !== '1')('import safety with PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let branches: typeof import('../branches');
  let mintlify: typeof import('./mintlify');
  let ghost: typeof import('./ghost');
  const ownedOrgs: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    branches = await import('../branches');
    mintlify = await import('./mintlify');
    ghost = await import('./ghost');
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    await db.prisma.project.deleteMany({ where: { organizationId: { in: ownedOrgs } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: ownedOrgs } } });
    await db.prisma.$disconnect();
  });

  const fixture = async () => {
    source.beforeRead = async () => undefined;
    source.files = new Map([
      ['docs.json', JSON.stringify({ navigation: [{ group: 'Guides', pages: ['intro'] }] })],
      ['intro.mdx', '---\ntitle: Introduction\n---\n# Imported content'],
    ]);
    const org = await db.prisma.organization.create({ data: { name: 'Synthetic import rehearsal' } });
    ownedOrgs.push(org.id);
    const project = await db.prisma.project.create({ data: { organizationId: org.id, name: 'Import rehearsal', slug: `import-${randomUUID()}` } });
    const main = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const run = () =>
      mintlify.mintlifyImporter.run({ organizationId: org.id, projectId: project.id, input: { repo: 'synthetic/docs', replaceExisting: false } });
    return { org, project, main, language, run };
  };

  it('keeps page IDs on preserving re-import after a version was promoted', async () => {
    const { project, main, run } = await fixture();
    await run();
    const page = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, branchId: main.id, kind: 'PAGE' } });
    const version = await branches.createBranch(project.id, { name: 'v2' });
    const copy = await db.prisma.page.findFirstOrThrow({ where: { branchId: version.id, kind: 'PAGE' } });
    await db.prisma.page.update({ where: { id: copy.id }, data: { content: '# Promoted content' } });
    await branches.mergeBranch(project.id, version.id);
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('# Promoted content');
    await run();
    const reimported = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, branchId: main.id, kind: 'PAGE' } });
    expect(reimported.id).toBe(page.id);
    expect(reimported.content).toBe('# Imported content');
    const again = await run();
    expect(again).toMatchObject({ imported: 0, updated: 1 });
    expect(await db.prisma.page.count({ where: { projectId: project.id } })).toBe(2);
    expect(await db.prisma.branch.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('retains an edit committed while the pinned source was downloading', async () => {
    const { project, main, run } = await fixture();
    await run();
    const page = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, branchId: main.id, kind: 'PAGE' } });
    let edited = false;
    source.beforeRead = async () => {
      if (edited) return;
      edited = true;
      await db.prisma.page.update({ where: { id: page.id }, data: { content: '# Owner edit during download' } });
    };
    await expect(run()).rejects.toMatchObject({ status: 409 });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('# Owner edit during download');
    expect(await db.prisma.branch.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('preserves comments and page identity when Ghost is re-imported', async () => {
    const { org, project, main } = await fixture();
    const input = { posts: [{ id: 'post', title: 'Welcome', slug: 'welcome', html: '<p>First</p>' }] };
    const run = () => ghost.ghostImporter.run({ organizationId: org.id, projectId: project.id, input });
    await run();
    const page = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, branchId: main.id, kind: 'PAGE' } });
    const user = await db.prisma.user.create({ data: { name: 'Synthetic writer', email: `${randomUUID()}@example.test` } });
    try {
      const comment = await db.prisma.comment.create({
        data: { projectId: project.id, pageId: page.id, userId: user.id, body: 'Keep this discussion' },
      });
      input.posts = [{ id: 'post', title: 'Welcome', slug: 'welcome', html: '<p>Second</p>' }];
      await run();
      expect((await db.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toBe('Second');
      expect((await db.prisma.comment.findUniqueOrThrow({ where: { id: comment.id } })).pageId).toBe(page.id);
    } finally {
      await db.prisma.user.delete({ where: { id: user.id } });
    }
  });
});
