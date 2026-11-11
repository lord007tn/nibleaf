import { randomUUID } from 'node:crypto';
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
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    pages = await import('./pages');
    history = await import('./page-history');
    erasure = await import('@nibleaf/auth/tenant-erasure');
  }, 120_000);
  afterAll(async () => {
    await db?.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db?.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
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
    const save = (content: string, user = 'author-a') => pages.updatePage(f.project.id, f.page.id, { content }, user);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => save(`Concurrent ${i}`)));
    expect(results.filter((r) => r.historySnapshot === 'stored')).toHaveLength(1);
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(1);
    expect((await save('Other author', 'author-b')).historySnapshot).toBe('stored');
    expect((await save('Continuous typing')).historySnapshot).toBe('throttled');
    await stateAt(f.page.id, 'author-a', 11, 11);
    expect((await save('After idle')).historySnapshot).toBe('stored');
    await stateAt(f.page.id, 'author-a', 1, 31);
    expect((await save('After continuous interval')).historySnapshot).toBe('stored');
    await stateAt(f.page.id, 'author-a', 11, 31);
    expect((await save('After continuous interval')).historySnapshot).toBe('unchanged');
  });

  it('reports oversized snapshots without storing content and enforces the byte cap including Unicode and titles', async () => {
    const f = await fixture();
    const result = await pages.updatePage(f.project.id, f.page.id, { content: '😀'.repeat(PAGE_REVISION_MAX_BYTES / 4) }, 'author');
    expect(result.historySnapshot).toBe('too-large');
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(0);
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
    await pages.updatePage(f.project.id, f.page.id, { content: 'Trigger retention' }, 'author');
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
    await stateAt(f.page.id, 'author', 11, 31);
    await pages.updatePage(f.project.id, f.page.id, { content: 'Small newest' }, 'author');
    const retained = await db.prisma.pageRevision.findMany({
      where: { pageId: f.page.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { contentBytes: true, content: true },
    });
    expect(retained.reduce((sum, row) => sum + row.contentBytes, 0)).toBeLessThanOrEqual(PAGE_HISTORY_MAX_BYTES);
    expect(retained).toHaveLength(20);
    expect(retained.at(-1)?.content).toBe('Small newest');
    // Age alone never discards recent tiny rows, even above 50.
    await db.prisma.pageRevision.deleteMany({ where: { pageId: f.page.id } });
    await db.prisma.pageRevision.createMany({ data: Array.from({ length: 55 }, () => ({ ...base, createdAt: new Date() })) });
    await stateAt(f.page.id, 'author', 11, 31);
    await pages.updatePage(f.project.id, f.page.id, { content: 'Recent rows survive' }, 'author');
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
    expect(listed.entries).toEqual([expect.objectContaining({ title: 'Published', contentBytes: 23, version: 1 })]);
    expect(JSON.stringify(listed)).not.toContain('secret');
    const compared = await history.comparePageHistory(f.project.id, f.page.id, selection);
    expect(compared).toMatchObject({ diff: { status: 'changed' }, title: { before: 'Published', after: 'Guide' } });
    await expect(history.comparePageHistory(sibling.project.id, sibling.page.id, selection)).rejects.toMatchObject({ status: 404 });
    await pages.updatePage(f.project.id, f.page.id, { content: 'x'.repeat(200_000) }, 'author');
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

  it('restores through the normal conditional update, preserves an undo copy, and rolls back on a stale revision or write failure', async () => {
    const f = await fixture();
    await pages.updatePage(f.project.id, f.page.id, { content: 'Saved revision' }, 'author');
    const revision = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id } });
    const selection = { source: 'revision' as const, entryId: revision.id };
    const edited = await pages.updatePage(f.project.id, f.page.id, { content: 'Unsaved by history', title: 'Renamed' }, 'author');
    const count = await db.prisma.pageRevision.count({ where: { pageId: f.page.id } });
    await expect(
      history.restorePageHistory(f.project.id, f.page.id, { ...selection, expectedUpdatedAt: f.page.updatedAt.toISOString() }, 'author'),
    ).rejects.toMatchObject({ status: 409, code: 'page:revision_conflict' });
    expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(count);
    const restored = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { ...selection, expectedUpdatedAt: edited.updatedAt.toISOString() },
      'author',
    );
    expect(restored).toMatchObject({ content: 'Saved revision', title: 'Guide' });
    const undo = await db.prisma.pageRevision.findFirstOrThrow({ where: { pageId: f.page.id, reason: 'before-restore' } });
    expect(undo).toMatchObject({ content: 'Unsaved by history', title: 'Renamed' });
    const undone = await history.restorePageHistory(
      f.project.id,
      f.page.id,
      { source: 'revision', entryId: undo.id, expectedUpdatedAt: restored.updatedAt.toISOString() },
      'author',
    );
    expect(undone).toMatchObject({ content: 'Unsaved by history', title: 'Renamed' });
    const before = await db.prisma.pageRevision.count({ where: { pageId: f.page.id } });
    const constraint = `history_${randomUUID().replaceAll('-', '')}`;
    await db.prisma.$executeRawUnsafe(`ALTER TABLE page ADD CONSTRAINT ${constraint} CHECK (id <> '${f.page.id}' OR content <> 'Saved revision')`);
    try {
      await expect(
        history.restorePageHistory(f.project.id, f.page.id, { ...selection, expectedUpdatedAt: undone.updatedAt.toISOString() }, 'author'),
      ).rejects.toThrow();
      expect(await db.prisma.pageRevision.count({ where: { pageId: f.page.id } })).toBe(before);
      expect((await db.prisma.page.findUniqueOrThrow({ where: { id: f.page.id } })).content).toBe('Unsaved by history');
    } finally {
      await db.prisma.$executeRawUnsafe(`ALTER TABLE page DROP CONSTRAINT ${constraint}`);
    }
    const huge = await pages.updatePage(f.project.id, f.page.id, { content: 'x'.repeat(PAGE_REVISION_MAX_BYTES + 1) }, 'author');
    await expect(
      history.restorePageHistory(f.project.id, f.page.id, { ...selection, expectedUpdatedAt: huge.updatedAt.toISOString() }, 'author'),
    ).rejects.toMatchObject({ status: 400, details: { reason: 'history_snapshot_too_large' } });
  });

  it('explicitly erases revision and throttle rows for one website, preserving its sibling, then erases the fixed organization manifest', async () => {
    const first = await fixture();
    const sibling = await fixture(first.org.id);
    await pages.updatePage(first.project.id, first.page.id, { content: 'Private first' }, 'author');
    await pages.updatePage(sibling.project.id, sibling.page.id, { content: 'Private sibling' }, 'author');
    await erasure.eraseProject(first.project.id);
    expect(await db.prisma.pageRevision.count({ where: { projectId: first.project.id } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: first.project.id } })).toBe(0);
    expect(await db.prisma.pageRevision.count({ where: { projectId: sibling.project.id } })).toBe(1);
    await erasure.eraseOrganization(first.org.id);
    expect(await db.prisma.pageRevision.count({ where: { projectId: sibling.project.id } })).toBe(0);
    expect(await db.prisma.pageRevisionState.count({ where: { projectId: sibling.project.id } })).toBe(0);
  });
});
