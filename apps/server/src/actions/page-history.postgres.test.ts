import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PAGE_HISTORY_MAX_BYTES, PAGE_REVISION_MAX_BYTES } from '@nibleaf/shared/page-history';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./platform-events', () => ({ logFirstContentEdit: vi.fn() }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), removeJob: vi.fn(), QueueNames: { ERASURE: 'erasure', SEARCH: 'search' } }));
vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({ ANALYTICS_MODE: 'postgres' }),
  clickHouseWritesEnabled: () => false,
  deleteProjectAnalytics: vi.fn(),
  deleteProjectAiConversations: vi.fn(),
  deleteProjectUsage: vi.fn(),
}));

describe.skipIf(process.env.PAGE_HISTORY_INTEGRATION !== '1')('page history PostgreSQL transactions', () => {
  let db: typeof import('@nibleaf/database');
  let pages: typeof import('./pages');
  let history: typeof import('./page-history');
  let erasure: typeof import('@nibleaf/auth/tenant-erasure');
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let author: string;
  let otherAuthor: string;
  const person = async () => {
    const user = await db.prisma.user.create({ data: { name: 'Fictional history author', email: `history-${randomUUID()}@nibleaf.test` } });
    userIds.push(user.id);
    return user.id;
  };
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    pages = await import('./pages');
    history = await import('./page-history');
    erasure = await import('@nibleaf/auth/tenant-erasure');
    author = await person();
    otherAuthor = await person();
  }, 120_000);
  afterAll(async () => {
    await db?.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db?.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db?.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db?.prisma.$disconnect();
  });
  const fixture = async (organizationId?: string) => {
    const org = organizationId ? { id: organizationId } : await db.prisma.organization.create({ data: { name: 'Fictional history tests' } });
    if (!organizationId) orgIds.push(org.id);
    const project = await db.prisma.project.create({ data: { organizationId: org.id, name: 'History fixture', slug: `history-${randomUUID()}` } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const page = await db.prisma.page.create({
      data: {
        projectId: project.id,
        branchId: branch.id,
        languageId: language.id,
        title: 'Guide',
        slug: 'guide',
        path: 'guide',
        content: 'Original',
      },
    });
    return { org, project, page };
  };
  const stateAt = async (pageId: string, userId: string, savedMinutes: number, snapshotMinutes: number) =>
    db.prisma.pageRevisionState.update({
      where: { pageId_userId: { pageId, userId } },
      data: { lastSavedAt: new Date(Date.now() - savedMinutes * 60_000), lastSnapshotAt: new Date(Date.now() - snapshotMinutes * 60_000) },
    });

  it('shares author throttles across concurrent tabs, separates authors, honors idle and continuous windows, and skips unchanged content', async () => {
    const f = await fixture();
    const save = (content: string, user = author) => pages.updatePage(f.project.id, f.page.id, { content }, user);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => save(`Concurrent ${i}`)));
    expect(results.filter((r) => r.historySnapshot === 'stored')).toHaveLength(1);
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(1);
    expect((await save('Other author', otherAuthor)).historySnapshot).toBe('stored');
    expect((await save('Continuous typing')).historySnapshot).toBe('throttled');
    await stateAt(f.page.id, author, 11, 11);
    expect((await save('After idle')).historySnapshot).toBe('stored');
    await stateAt(f.page.id, author, 1, 31);
    expect((await save('After continuous interval')).historySnapshot).toBe('stored');
    expect(await db.prisma.pageRevision.findFirst({ where: { pageId: f.page.id, content: 'After idle' } })).toMatchObject({
      reason: 'autosave',
      title: 'Guide',
    });
    await stateAt(f.page.id, author, 11, 31);
    expect((await save('After continuous interval')).historySnapshot).toBe('unchanged');
  });

  it('preserves a never-revisioned page before its first edit and restores that original state', async () => {
    const f = await fixture();
    const saved = await pages.updatePage(f.project.id, f.page.id, { title: 'Edited title', content: 'First editing session' }, author);
    const revision = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    expect(revision).toMatchObject({ title: 'Guide', content: 'Original', reason: 'autosave' });
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { source: 'revision', entryId: revision.id, expectedUpdatedAt: saved.updatedAt.toISOString() },
      author,
    );
    expect(restored).toMatchObject({ title: 'Guide', content: 'Original' });
  });

  it('skips identical consecutive snapshots even when a later changed save is due', async () => {
    const f = await fixture();
    await pages.updatePage(f.project.id, f.page.id, { content: 'First edit' }, author);
    await pages.updatePage(f.project.id, f.page.id, { content: 'Original' }, author);
    await stateAt(f.page.id, author, 11, 31);
    const saved = await pages.updatePage(f.project.id, f.page.id, { content: 'Another edit' }, author);
    expect(saved).toMatchObject({ content: 'Another edit', historySnapshot: 'unchanged' });
    expect(await db.prisma.pageRevision.findMany({ where: { pageId: f.page.id } })).toEqual([expect.objectContaining({ content: 'Original' })]);
  });

  it('reports oversized snapshots without storing content and enforces the byte cap including Unicode and titles', async () => {
    const f = await fixture();
    const first = await pages.updatePage(f.project.id, f.page.id, { content: '😀'.repeat(PAGE_REVISION_MAX_BYTES / 4) }, author);
    expect(first.historySnapshot).toBe('stored');
    const result = await pages.updatePage(f.project.id, f.page.id, { content: 'Now smaller' }, author);
    expect(result.historySnapshot).toBe('too-large');
    expect(await db.prisma.pageRevision.findMany({ where: { pageId: f.page.id } })).toEqual([expect.objectContaining({ content: 'Original' })]);
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: f.page.id } })).content).toBe(result.content);
  });

  it('keeps newest 50 plus recent entries, then prunes oldest first when the hard byte budget overrides age', async () => {
    const f = await fixture();
    const base = { projectId: f.project.id, pageId: f.page.id, title: 'Guide', content: 'x', contentBytes: 6, reason: 'autosave' };
    await db.prisma.pageRevision.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        ...base,
        id: `old-${i}-${randomUUID()}`,
        createdAt: new Date(Date.now() - (60 - i) * 86_400_000),
      })),
    });
    await pages.updatePage(f.project.id, f.page.id, { content: 'Trigger retention' }, author);
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(50);
    await db.prisma.pageRevision.deleteMany({ where: { pageId: f.page.id } });
    const large = 'x'.repeat(PAGE_REVISION_MAX_BYTES - Buffer.byteLength(base.title));
    await db.prisma.pageRevision.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        ...base,
        id: `large-${i}-${randomUUID()}`,
        content: large,
        contentBytes: PAGE_REVISION_MAX_BYTES,
        createdAt: new Date(Date.now() - (25 - i) * 1000),
      })),
    });
    await stateAt(f.page.id, author, 11, 31);
    await pages.updatePage(f.project.id, f.page.id, { content: 'Small newest' }, author);
    const retained = await db.prisma.pageRevision.findMany({
      where: { pageId: f.page.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { contentBytes: true, content: true },
    });
    expect(retained.reduce((sum, row) => sum + row.contentBytes, 0)).toBeLessThanOrEqual(PAGE_HISTORY_MAX_BYTES);
    expect(retained).toHaveLength(20);
    expect(retained.at(-1)?.content).toBe('Trigger retention');
    // Age alone never discards recent tiny rows, even above 50.
    await db.prisma.pageRevision.deleteMany({ where: { pageId: f.page.id } });
    await db.prisma.pageRevision.createMany({ data: Array.from({ length: 55 }, () => ({ ...base, createdAt: new Date() })) });
    await stateAt(f.page.id, author, 11, 31);
    await pages.updatePage(f.project.id, f.page.id, { content: 'Recent rows survive' }, author);
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(56);
  });

  it('reads only this published page, compares on the server, paginates, and isolates page/project selections', async () => {
    const f = await fixture();
    const sibling = await fixture(f.org.id);
    const deployment = await db.prisma.deployment.create({
      data: {
        projectId: f.project.id,
        version: 1,
        status: 'READY',
        snapshot: {
          pages: [
            { id: sibling.page.id, title: 'Never return', content: 'secret'.repeat(200_000) },
            { id: f.page.id, title: 'Published', content: 'Published line' },
          ],
        },
      },
    });
    const selection = { source: 'published' as const, entryId: deployment.id };
    const listed = await history.listPageHistory(f.project.id, f.page.id, { source: 'published' });
    expect(listed.entries).toEqual([expect.objectContaining({ title: 'Published', version: 1 })]);
    expect(listed.entries[0]?.contentBytes).toBeGreaterThan(23);
    expect(JSON.stringify(listed)).not.toContain('secret');
    const compared = await history.comparePageHistory(f.project.id, f.page.id, selection);
    expect(compared).toMatchObject({ diff: { status: 'changed' }, title: { before: 'Published', after: 'Guide' } });
    await expect(history.comparePageHistory(sibling.project.id, sibling.page.id, selection)).rejects.toMatchObject({ status: 404 });
    await pages.updatePage(f.project.id, f.page.id, { content: 'x'.repeat(200_000) }, author);
    expect((await history.comparePageHistory(f.project.id, f.page.id, selection)).diff).toEqual({ status: 'too-large', limit: 'bytes' });
    await db.prisma.pageRevision.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        projectId: f.project.id,
        pageId: f.page.id,
        title: 'Older',
        content: `${i}`,
        contentBytes: 7,
        reason: 'autosave',
      })),
    });
    const first = await history.listPageHistory(f.project.id, f.page.id, { source: 'revision' });
    expect(first.entries).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await history.listPageHistory(f.project.id, f.page.id, { source: 'revision', ...first.next });
    expect(second.entries).toHaveLength(4);
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(54);
  });

  it('paginates published history in batches of 20 with an exact date/id cursor', async () => {
    const f = await fixture();
    const createdAt = new Date('2026-11-11T09:00:00.000Z');
    const deployments = Array.from({ length: 23 }, (_, i) => ({
      id: `published-${String(i).padStart(2, '0')}-${randomUUID()}`,
      projectId: f.project.id,
      version: i + 1,
      status: 'READY' as const,
      createdAt,
      snapshot: { pages: [{ id: f.page.id, title: `Published ${i}`, content: 'Published content' }] },
    }));
    await db.prisma.deployment.createMany({ data: deployments });
    const expected = deployments
      .map((deployment) => deployment.id)
      .sort()
      .reverse();
    const first = await history.listPageHistory(f.project.id, f.page.id, { source: 'published' });
    expect(first.entries.map((entry) => entry.id)).toEqual(expected.slice(0, 20));
    expect(first.next).toEqual({ before: createdAt.toISOString(), beforeId: expected[19] });
    const second = await history.listPageHistory(f.project.id, f.page.id, { source: 'published', ...first.next });
    expect(second.entries.map((entry) => entry.id)).toEqual(expected.slice(20));
    expect(second.next).toBeNull();
  });

  it('bounds missing-page published reads to one candidate batch and advances past every examined deployment', async () => {
    const f = await fixture();
    const snapshot = { pages: Array.from({ length: 300 }, (_, i) => ({ id: `other-${i}`, title: 'Other', content: 'x'.repeat(2048) })) };
    const createdAt = new Date('2026-11-11T09:00:00.000Z');
    const ids = Array.from({ length: 61 }, (_, i) => `missing-${String(i).padStart(3, '0')}-${randomUUID()}`);
    await db.prisma.deployment.createMany({
      data: ids.map((id, i) => ({ id, projectId: f.project.id, version: i + 1, status: 'READY', createdAt, snapshot })),
    });
    await db.prisma.deployment.createMany({
      data: Array.from({ length: 2000 }, (_, i) => ({
        projectId: f.project.id,
        version: i + 62,
        status: 'READY',
        createdAt: new Date('2020-01-01'),
        snapshot: {},
      })),
    });
    await db.prisma.$executeRaw`ANALYZE deployment`;
    const capture = vi.spyOn(db.prisma, '$queryRaw');
    const first = await history.listPageHistory(f.project.id, f.page.id, { source: 'published' });
    const [strings, ...values] = capture.mock.calls[0] ?? [];
    capture.mockRestore();
    expect(first.entries).toEqual([]);
    expect(first.next).toEqual({ before: createdAt.toISOString(), beforeId: ids[41] });
    const second = await history.listPageHistory(f.project.id, f.page.id, { source: 'published', ...first.next });
    expect(second.entries).toEqual([]);
    expect(second.next).toEqual({ before: createdAt.toISOString(), beforeId: ids[21] });
    const statement = db.Prisma.sql(strings as TemplateStringsArray, ...values);
    type Plan = { 'Subplan Name'?: string; 'Index Name'?: string; 'Actual Loops'?: number; 'Actual Rows': number; Plans?: Plan[] };
    const explained = await db.prisma.$queryRaw<Array<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>>(
      db.Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
    );
    const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
    const plans = nodes(explained[0]?.['QUERY PLAN'][0]?.Plan as Plan);
    expect(plans.find((plan) => plan['Subplan Name'] === 'CTE candidates')?.['Actual Rows']).toBe(20);
    expect(plans.find((plan) => plan['Subplan Name'] === 'CTE extracted')?.['Actual Rows']).toBe(20);
    expect(plans.find((plan) => plan['Index Name'] === 'deployment_pkey')).toMatchObject({ 'Actual Rows': 1, 'Actual Loops': 20 });
    if (process.env.PAGE_HISTORY_EXPLAIN_FILE) {
      const text = await db.prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(db.Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${statement}`);
      writeFileSync(process.env.PAGE_HISTORY_EXPLAIN_FILE, text.map((line) => line['QUERY PLAN']).join('\n'));
    }
  }, 60_000);

  it('captures settings-only changes and restores exact settings, removing newer config keys', async () => {
    const f = await fixture();
    const config = { seo: { metaTitle: 'Original SEO' }, sidebarTitle: 'Original sidebar' };
    await db.prisma.page.update({ where: { id: f.page.id }, data: { description: 'Original description', icon: 'Book', config } });
    const changed = await pages.updatePage(
      f.project.id,
      f.page.id,
      { description: null, icon: null, hidden: true, config: { mode: 'wide', seo: { noindex: true } } },
      author,
    );
    expect(changed.historySnapshot).toBe('stored');
    const revision = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    expect(revision).toMatchObject({ description: 'Original description', icon: 'Book', hidden: false, config });
    expect(revision.contentBytes).toBeGreaterThan(Buffer.byteLength(`${revision.title}${revision.content}Original descriptionBook`));
    const selection = { source: 'revision' as const, entryId: revision.id };
    expect((await history.comparePageHistory(f.project.id, f.page.id, selection)).diff.status).toBe('changed');
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { ...selection, expectedUpdatedAt: changed.updatedAt.toISOString() },
      author,
    );
    expect(restored).toMatchObject({ description: 'Original description', icon: 'Book', hidden: false });
    expect(restored.config).toEqual(config);
  });

  it('round-trips mixed content and settings, including nulls, through restore and its undo revision', async () => {
    const f = await fixture();
    const mixed = {
      title: 'New title',
      content: 'New content',
      description: 'New description',
      icon: 'Star',
      hidden: true,
      config: { mode: 'wide' as const, hideToc: true },
    };
    const saved = await pages.updatePage(f.project.id, f.page.id, mixed, author);
    const original = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { source: 'revision', entryId: original.id, expectedUpdatedAt: saved.updatedAt.toISOString() },
      author,
    );
    expect(restored).toMatchObject({ title: 'Guide', content: 'Original', description: null, icon: null, hidden: false, config: null });
    const undo = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id, reason: 'before-restore' } });
    expect(undo).toMatchObject(mixed);
    expect(
      await history.restorePageHistory(
        f.project.id,
        f.page.id,
        { source: 'revision', entryId: undo.id, expectedUpdatedAt: restored.updatedAt.toISOString() },
        author,
      ),
    ).toMatchObject(mixed);
  });

  it('includes recoverable settings in the revision byte cap', async () => {
    const f = await fixture();
    await db.prisma.page.update({ where: { id: f.page.id }, data: { config: { sidebarTitle: 'x'.repeat(PAGE_REVISION_MAX_BYTES) } } });
    const saved = await pages.updatePage(f.project.id, f.page.id, { icon: 'Star' }, author);
    expect(saved.historySnapshot).toBe('too-large');
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(0);
  });

  it('prunes more than 200 tiny recent revisions to the newest 200', async () => {
    const f = await fixture();
    await db.prisma.pageRevision.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        projectId: f.project.id,
        pageId: f.page.id,
        id: `tiny-${i}-${randomUUID()}`,
        title: 'Tiny',
        content: '',
        contentBytes: 4,
        reason: 'autosave',
        createdAt: new Date(Date.now() - (250 - i) * 1000),
      })),
    });
    await pages.updatePage(f.project.id, f.page.id, { content: 'Trigger prune' }, author);
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(200);
    expect(await db.prisma.pageRevision.findFirst({ where: { pageId: f.page.id, id: { startsWith: 'tiny-0-' } } })).toBeNull();
    expect(await db.prisma.pageRevision.findFirst({ where: { pageId: f.page.id, content: 'Original' } })).not.toBeNull();
  });

  it('keeps the current placeholder URL and performs no address rewriting when restoring an older title', async () => {
    const f = await fixture();
    await pages.updatePage(f.project.id, f.page.id, { content: 'Edited' }, author);
    const revision = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    const placeholder = await db.prisma.page.update({ where: { id: f.page.id }, data: { title: 'Untitled', slug: 'untitled', path: 'untitled' } });
    const projectBefore = await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } });
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { source: 'revision', entryId: revision.id, expectedUpdatedAt: placeholder.updatedAt.toISOString() },
      author,
    );
    expect(restored).toMatchObject({
      title: 'Guide',
      slug: 'untitled',
      path: 'untitled',
      redirectsAdded: 0,
      linksUpdated: 0,
      documentsSkipped: 0,
      addressChanged: false,
    });
    expect((await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })).config).toEqual(projectBefore.config);
  });

  it('restores a moved page in its current parent, position and address', async () => {
    const f = await fixture();
    await pages.updatePage(f.project.id, f.page.id, { content: 'Edited' }, author);
    const revision = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    const parent = await db.prisma.page.create({
      data: {
        projectId: f.project.id,
        branchId: f.page.branchId,
        languageId: f.page.languageId,
        title: 'Moved',
        slug: 'moved',
        path: 'moved',
        kind: 'GROUP',
      },
    });
    const moved = await pages.updatePage(f.project.id, f.page.id, { parentId: parent.id }, author);
    const projectBefore = await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } });
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { source: 'revision', entryId: revision.id, expectedUpdatedAt: moved.updatedAt.toISOString() },
      author,
    );
    expect(restored).toMatchObject({
      content: 'Original',
      parentId: parent.id,
      position: moved.position,
      slug: moved.slug,
      path: 'moved/guide',
      redirectsAdded: 0,
      linksUpdated: 0,
      addressChanged: false,
    });
    expect((await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })).config).toEqual(projectBefore.config);
  });

  it('restores published settings where present and retains current settings omitted by legacy snapshots', async () => {
    const f = await fixture();
    const settings = { description: 'Published description', icon: 'Book', hidden: true, config: { mode: 'wide' } };
    const published = await db.prisma.deployment.create({
      data: {
        projectId: f.project.id,
        version: 1,
        status: 'READY',
        snapshot: {
          pages: [
            { id: f.page.id, title: 'Published', content: 'Published body', ...settings, parentId: 'old-parent', slug: 'old-slug', path: 'old-path' },
          ],
        },
      },
    });
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { source: 'published', entryId: published.id, expectedUpdatedAt: f.page.updatedAt.toISOString() },
      author,
    );
    expect(restored).toMatchObject({ ...settings, slug: 'guide', path: 'guide', parentId: null });
    const legacy = await db.prisma.deployment.create({
      data: {
        projectId: f.project.id,
        version: 2,
        status: 'READY',
        snapshot: { pages: [{ id: f.page.id, title: 'Legacy', content: 'Legacy body' }] },
      },
    });
    expect(
      await history.restorePageHistory(
        f.project.id,
        f.page.id,
        { source: 'published', entryId: legacy.id, expectedUpdatedAt: restored.updatedAt.toISOString() },
        author,
      ),
    ).toMatchObject({ ...settings, title: 'Legacy', content: 'Legacy body' });
  });

  it('anonymizes retained revisions and cascades throttle state when an account is deleted', async () => {
    const f = await fixture();
    const removedAuthor = await person();
    await pages.updatePage(f.project.id, f.page.id, { content: 'Edited by deleted account' }, removedAuthor);
    const revision = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    expect(revision.userId).toBe(removedAuthor);
    expect(await db.prisma.pageRevisionState.count({ where: { userId: removedAuthor } })).toBe(1);
    expect((await history.listPageHistory(f.project.id, f.page.id, { source: 'revision' })).entries[0]?.author).toBe('Fictional history author');
    // The account-deletion precondition allows this non-owner; the final user
    // delete also covers callers that rely directly on database cascades.
    const { reassignOrDeleteOrgs } = await import('@nibleaf/auth/account-deletion');
    await reassignOrDeleteOrgs(removedAuthor);
    await db.prisma.user.delete({ where: { id: removedAuthor } });
    expect(await db.prisma.pageRevisionState.count({ where: { userId: removedAuthor } })).toBe(0);
    expect(await db.prisma.pageRevision.findUniqueOrThrow({ where: { id: revision.id } })).toMatchObject({ userId: null, content: 'Original' });
    // A null author is the list contract for the UI's localized unknown-author label.
    expect((await history.listPageHistory(f.project.id, f.page.id, { source: 'revision' })).entries).toEqual([
      expect.objectContaining({ id: revision.id, author: null }),
    ]);
  });

  it('restores through the normal conditional update, preserves an undo copy, and rolls back on a stale revision or write failure', async () => {
    const f = await fixture();
    await pages.updatePage(f.project.id, f.page.id, { content: 'Saved revision' }, author);
    const revision = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    const selection = { source: 'revision' as const, entryId: revision.id };
    const edited = await pages.updatePage(f.project.id, f.page.id, { content: 'Unsaved by history', title: 'Renamed' }, author);
    const count = await db.prisma.pageRevision.count({ where: { pageId: f.page.id } });
    await expect(
      history.restorePageHistory(f.project.id, f.page.id, { ...selection, expectedUpdatedAt: f.page.updatedAt.toISOString() }, author),
    ).rejects.toMatchObject({ status: 409, code: 'page:revision_conflict' });
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(count);
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { ...selection, expectedUpdatedAt: edited.updatedAt.toISOString() },
      author,
    );
    expect(restored).toMatchObject({ content: 'Original', title: 'Guide' });
    const undo = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id, reason: 'before-restore' } });
    expect(undo).toMatchObject({ content: 'Unsaved by history', title: 'Renamed' });
    const undone = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { source: 'revision', entryId: undo.id, expectedUpdatedAt: restored.updatedAt.toISOString() },
      author,
    );
    expect(undone).toMatchObject({ content: 'Unsaved by history', title: 'Renamed' });
    const before = await db.prisma.pageRevision.count({ where: { pageId: f.page.id } });
    const constraint = `history_${randomUUID().replaceAll('-', '')}`;
    await db.prisma.$executeRawUnsafe(`ALTER TABLE page ADD CONSTRAINT ${constraint} CHECK (id <> '${f.page.id}' OR content <> 'Original')`);
    try {
      await expect(
        history.restorePageHistory(f.project.id, f.page.id, { ...selection, expectedUpdatedAt: undone.updatedAt.toISOString() }, author),
      ).rejects.toThrow();
      expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(before);
      expect((await db.prisma.page.findUniqueOrThrow({ where: { id: f.page.id } })).content).toBe('Unsaved by history');
    } finally {
      await db.prisma.$executeRawUnsafe(`ALTER TABLE page DROP CONSTRAINT ${constraint}`);
    }
    const huge = await pages.updatePage(f.project.id, f.page.id, { content: 'x'.repeat(PAGE_REVISION_MAX_BYTES + 1) }, author);
    await expect(
      history.restorePageHistory(f.project.id, f.page.id, { ...selection, expectedUpdatedAt: huge.updatedAt.toISOString() }, author),
    ).rejects.toMatchObject({ status: 400, details: { reason: 'history_snapshot_too_large' } });
  });

  it('explicitly erases revision and throttle rows for one website, preserving its sibling, then erases the fixed organization manifest', async () => {
    const first = await fixture();
    const sibling = await fixture(first.org.id);
    await pages.updatePage(first.project.id, first.page.id, { content: 'Private first' }, author);
    await pages.updatePage(sibling.project.id, sibling.page.id, { content: 'Private sibling' }, author);
    await erasure.eraseProject(first.project.id);
    expect(await db.prisma.pageRevision.count({ where: { projectId: first.project.id } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: first.project.id } })).toBe(0);
    expect(await db.prisma.pageRevision.count({ where: { projectId: sibling.project.id } })).toBe(1);
    await erasure.eraseOrganization(first.org.id);
    expect(await db.prisma.pageRevision.count({ where: { projectId: sibling.project.id } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: sibling.project.id } })).toBe(0);
  });
});
