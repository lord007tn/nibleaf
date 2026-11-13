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
    if (process.env.NIBLEAF_IMPORT_LOCAL_ONLY === '1') expect(Reflect.get(globalThis, Symbol.for('nibleaf.import-network-attempts'))).toEqual([]);
    db = await import('@nibleaf/database');
    branches = await import('../branches');
    mintlify = await import('./mintlify');
    ghost = await import('./ghost');
  }, 60_000);
  afterAll(async () => {
    if (process.env.NIBLEAF_IMPORT_LOCAL_ONLY === '1') {
      expect(Reflect.get(globalThis, Symbol.for('nibleaf.import-network-attempts'))).toEqual([]);
      console.info('Import safety worker: outside transport attempts 0.');
    }
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
    const run = (sourceUrl?: string) =>
      mintlify.mintlifyImporter.run({
        organizationId: org.id,
        projectId: project.id,
        input: { repo: 'synthetic/docs', replaceExisting: false, sourceUrl },
      });
    return { org, project, main, language, run };
  };

  it('promotes Mintlify video, divider and source/app links with per-occurrence fidelity rows', async () => {
    const { project, run } = await fixture();
    source.files.set(
      'intro.mdx',
      '---\ntitle: Tour\n---\nTour\n\n<iframe src="https://youtu.be/abcdefghijk" title="Tour"></iframe>\n\n/\n\n<p>---</p>\n\n[Next](https://nibleaf.com/pages/next?lang=ar#start)\n\n<iframe src="https://frame.example.test/tour"></iframe>\n\n[Missing](/missing)',
    );
    source.files.set('next.mdx', 'Next page');
    source.files.set('docs.json', JSON.stringify({ navigation: [{ group: 'Guides', pages: ['intro', 'next'] }] }));
    const report = await run();
    const page = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, slug: 'intro' } });
    expect(page.content).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Tour"></iframe>');
    expect(page.content).toContain('\n\n---\n\n');
    expect(page.content).not.toContain('\n/\n');
    expect(page.content).toContain('[Next](https://nibleaf.com/pages/next?lang=ar#start)');
    expect(report.fidelityIssues).toEqual(
      expect.arrayContaining([
        { kind: 'link', page: 'intro', reference: '/missing' },
        { kind: 'embed', page: 'intro', reference: 'https://frame.example.test/tour' },
        { kind: 'link', page: 'intro', reference: 'https://nibleaf.com/pages/next?lang=ar#start' },
      ]),
    );
  });

  it('council re-check: promotes literal code and authored src video metadata without spurious reports', async () => {
    const { project, run } = await fixture();
    const literal = 'Example:\n\n    [Next](https://help.test/next)\n    [Missing](https://help.test/missing)\n    ![Missing](./missing.png)';
    const video = '<video src="https://cdn.test/a.mp4" poster="/poster.jpg" title="Original" width="640" controls></video>';
    source.files.set('intro.mdx', `${literal}\n\n${video}`);
    source.files.set('next.mdx', 'Next page');
    source.files.set('docs.json', JSON.stringify({ navigation: [{ group: 'Guides', pages: ['intro', 'next'] }] }));
    const report = await run('https://help.test');
    const page = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, slug: 'intro' } });
    expect(page.content).toBe(`${literal}\n\n${video}`);
    expect(report.fidelityIssues ?? []).toEqual([]);
    expect(report.warnings).toEqual(['Replaced the existing draft navigation only after the complete Mintlify import succeeded.']);
  });

  it('full review: keeps foreign-language discovery out of English and decodes HTML lang entities', async () => {
    const { project, run } = await fixture();
    source.files.set(
      'docs.json',
      JSON.stringify({
        navigation: {
          languages: [
            { language: 'en', pages: ['intro'] },
            { language: 'ar', pages: ['ar/intro'] },
          ],
        },
      }),
    );
    const foreign = 'https://help.test/ar/hidden?lang=ar';
    source.files.set(
      'intro.mdx',
      `[Arabic](${foreign})\n\n[English](https://help.test/en/hidden?lang=en)\n\n<a href="https://nibleaf.com/pages/intro?x=1&amp;lang=ar">Arabic introduction</a>`,
    );
    source.files.set('ar/intro.mdx', 'Arabic introduction.');
    source.files.set('ar/hidden.mdx', 'Arabic hidden content.');
    source.files.set('en/hidden.mdx', 'English hidden content.');
    const report = await run('https://help.test');
    const english = await db.prisma.page.findMany({ where: { projectId: project.id, language: { code: 'en' } } });
    expect(english.some((page) => page.content === 'Arabic hidden content.')).toBe(false);
    expect(english.some((page) => page.content === 'English hidden content.')).toBe(true);
    expect(english.find((page) => page.slug === 'intro')?.content).toContain('<a href="/intro?x=1&amp;lang=ar">Arabic introduction</a>');
    expect(report.fidelityIssues).toContainEqual({ kind: 'link', page: 'intro', reference: foreign });
  });

  it('council P2: promotes an explicit Arabic link to the Arabic route, without English fallback', async () => {
    const { project, run } = await fixture();
    source.files.set(
      'docs.json',
      JSON.stringify({
        navigation: {
          languages: [
            { language: 'en', groups: [{ group: 'English', pages: ['intro', 'en/next'] }] },
            { language: 'ar', groups: [{ group: 'Arabic', pages: ['ar/next'] }] },
          ],
        },
      }),
    );
    source.files.set('intro.mdx', '[Next](https://nibleaf.com/pages/next?lang=ar#start)\n\n[Missing](https://nibleaf.com/pages/missing?lang=ar)');
    source.files.set('en/next.mdx', 'English destination.');
    source.files.set('ar/next.mdx', 'Arabic destination.');
    const report = await run();
    const imported = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, slug: 'intro' } });
    expect(imported.content).toContain('[Next](/arabic/next?lang=ar#start)');
    const arabic = await db.prisma.page.findFirstOrThrow({ where: { projectId: project.id, path: 'arabic/next' }, include: { language: true } });
    expect(arabic.language.code).toBe('ar');
    expect(report.fidelityIssues).toContainEqual({ kind: 'link', page: 'intro', reference: 'https://nibleaf.com/pages/missing?lang=ar' });
  });

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
