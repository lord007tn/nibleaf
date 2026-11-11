import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildSnapshot } from '@nibleaf/shared/site';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const metrics = vi.hoisted(() => ({ active: false, parsesUnderLock: 0, transactionMs: 0, parses: 0 }));
vi.mock('mdast-util-from-markdown', async (original) => {
  const actual = await original<typeof import('mdast-util-from-markdown')>();
  return {
    ...actual,
    fromMarkdown: (...args: Parameters<typeof actual.fromMarkdown>) => {
      metrics.parses++;
      if (metrics.active) metrics.parsesUnderLock++;
      return actual.fromMarkdown(...args);
    },
  };
});

describe.skipIf(process.env.PAGE_ADDRESS_INTEGRATION !== '1')('page address transactions in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let actions: typeof import('./pages');
  let beforeTransaction: (() => Promise<void>) | undefined;
  afterEach(() => {
    beforeTransaction = undefined;
  });
  const organizations: string[] = [];
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    actions = await import('./pages');
    const transaction = db.prisma.$transaction.bind(db.prisma);
    vi.spyOn(db.prisma, '$transaction').mockImplementation((async (
      work: (tx: import('@nibleaf/database').Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) => {
      await beforeTransaction?.();
      const start = performance.now();
      try {
        return await transaction(async (tx) => {
          metrics.active = true;
          try {
            return await work(tx);
          } finally {
            metrics.active = false;
          }
        }, options);
      } finally {
        metrics.transactionMs = performance.now() - start;
      }
    }) as typeof db.prisma.$transaction);
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await db?.prisma.project.deleteMany({ where: { organizationId: { in: organizations } } });
    await db?.prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await db?.prisma.$disconnect();
  }, 60_000);

  const fixture = async (count = 2) => {
    const slug = `address-${randomUUID()}`;
    const org = await db.prisma.organization.create({ data: { name: 'Synthetic address regression' } });
    organizations.push(org.id);
    const project = await db.prisma.project.create({ data: { organizationId: org.id, name: 'Synthetic docs', slug } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const text = count > 2 ? `${'Documentation paragraph. '.repeat(503)}\n\n[link](/old#install)` : '[link](/old)';
    await db.prisma.page.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        id: `${slug}-${index}`,
        projectId: project.id,
        branchId: branch.id,
        languageId: language.id,
        title: `Page ${index}`,
        slug: index ? `source-${index}` : 'old',
        path: index ? `source-${index}` : 'old',
        content: text,
        position: index,
      })),
    });
    const pages = await db.prisma.page.findMany({ where: { projectId: project.id }, orderBy: { position: 'asc' } });
    const snapshot = buildSnapshot(
      { ...project, branches: [branch], languages: [language] },
      pages.map((page) => ({ ...page, languageCode: 'en', createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString() })),
      new Date().toISOString(),
    );
    await db.prisma.deployment.create({
      data: {
        projectId: project.id,
        version: 1,
        status: 'READY',
        snapshot: snapshot as unknown as import('@nibleaf/database').Prisma.InputJsonValue,
      },
    });
    const target = pages[0];
    const source = pages[1];
    if (!target || !source) throw new Error('Page fixture was not created');
    return { project, target, source, text, count };
  };

  const moveUnderSource = (f: Awaited<ReturnType<typeof fixture>>) => ({
    items: [{ id: f.target.id, parentId: f.source.id, position: 0 }],
  });

  it('a pure bulk reorder succeeds while another page saves, without parsing links', async () => {
    const f = await fixture();
    const parses = metrics.parses;
    beforeTransaction = async () => {
      await db.prisma.page.update({ where: { id: f.source.id }, data: { content: 'Concurrent content save' } });
    };
    await actions.reorderPages(f.project.id, {
      items: [
        { id: f.source.id, parentId: null, position: 0 },
        { id: f.target.id, parentId: null, position: 1 },
      ],
    });
    expect(metrics.parses).toBe(parses);
    expect(await db.prisma.page.findUnique({ where: { id: f.source.id } })).toMatchObject({ position: 0, content: 'Concurrent content save' });
    expect(await db.prisma.page.findUnique({ where: { id: f.target.id } })).toMatchObject({ position: 1, path: 'old' });
  });

  it('an address move ignores an unrelated save and still relinks and redirects', async () => {
    const f = await fixture(3);
    const unrelated = await db.prisma.page.findFirstOrThrow({ where: { projectId: f.project.id, position: 2 } });
    await db.prisma.page.update({ where: { id: unrelated.id }, data: { content: 'Unrelated content' } });
    let attempts = 0;
    beforeTransaction = async () => {
      attempts++;
      await db.prisma.page.update({ where: { id: unrelated.id }, data: { content: `Concurrent unrelated save ${attempts}` } });
    };
    await actions.reorderPages(f.project.id, moveUnderSource(f));
    expect(attempts).toBe(1);
    expect(await db.prisma.page.findUnique({ where: { id: f.target.id } })).toMatchObject({ path: 'source-1/old' });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: f.source.id } })).content).toContain('](/source-1/old#install)');
    expect((await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })).config).toMatchObject({
      redirects: [{ from: '/old', to: '/source-1/old', generated: true }],
    });
    expect((await db.prisma.page.findUniqueOrThrow({ where: { id: unrelated.id } })).content).toBe('Concurrent unrelated save 1');
  });

  it('an address move conflicts after three attempts if a relinked page keeps saving', async () => {
    const f = await fixture();
    let attempts = 0;
    beforeTransaction = async () => {
      attempts++;
      await db.prisma.page.update({ where: { id: f.source.id }, data: { content: `${f.text} save ${attempts}` } });
    };
    await expect(actions.reorderPages(f.project.id, moveUnderSource(f))).rejects.toMatchObject({
      code: 'page:address_conflict',
      details: { reason: 'address_raced' },
    });
    expect(attempts).toBe(3);
    expect(await db.prisma.page.findUnique({ where: { id: f.target.id } })).toMatchObject({ path: 'old', parentId: null });
    expect(await db.prisma.page.findUnique({ where: { id: f.source.id } })).toMatchObject({ content: `${f.text} save 3` });
    expect((await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })).config).toEqual(f.project.config);
  });

  it('bulk items retry with fresh content after one relink revision race', async () => {
    const f = await fixture();
    let attempts = 0;
    beforeTransaction = async () => {
      if (++attempts !== 1) return;
      await db.prisma.page.update({ where: { id: f.source.id }, data: { content: `${f.text} saved text` } });
    };
    metrics.parsesUnderLock = 0;
    await actions.reorderPages(f.project.id, moveUnderSource(f));
    expect(attempts).toBe(2);
    expect(metrics.parsesUnderLock).toBe(0);
    expect(await db.prisma.page.findUnique({ where: { id: f.source.id } })).toMatchObject({ content: '[link](/source-1/old) saved text' });
  });

  it('bulk retries retain the expected structure revision precondition', async () => {
    const f = await fixture();
    const pages = await db.prisma.page.findMany({ where: { projectId: f.project.id } });
    let attempts = 0;
    beforeTransaction = async () => {
      attempts++;
      await db.prisma.page.update({ where: { id: f.source.id }, data: { position: 7 } });
    };
    await expect(
      actions.reorderPages(f.project.id, {
        ...moveUnderSource(f),
        expectedStructureRevision: actions.pageStructureRevision(pages),
      }),
    ).rejects.toMatchObject({ details: { reason: 'structure_changed' } });
    expect(attempts).toBe(1);
  });

  it('council: real PostgreSQL rollback, commit, and stale autosave preserve the address-link invariant', async () => {
    const f = await fixture();
    const constraint = `address_test_${randomUUID().replaceAll('-', '')}`;
    // Scoped to one fictional row in this disposable migrated database.
    await db.prisma.$executeRawUnsafe(`ALTER TABLE page ADD CONSTRAINT ${constraint} CHECK (id <> '${f.source.id}' OR content NOT LIKE '%/new%')`);
    try {
      await expect(actions.updatePage(f.project.id, f.target.id, { slug: 'new' })).rejects.toThrow();
      expect(await db.prisma.page.findUnique({ where: { id: f.target.id } })).toMatchObject({ path: 'old', slug: 'old' });
      expect(await db.prisma.page.findUnique({ where: { id: f.source.id } })).toMatchObject({ content: f.text });
      expect((await db.prisma.project.findUniqueOrThrow({ where: { id: f.project.id } })).config).toEqual(f.project.config);
    } finally {
      await db.prisma.$executeRawUnsafe(`ALTER TABLE page DROP CONSTRAINT ${constraint}`);
    }
    await actions.updatePage(f.project.id, f.target.id, { slug: 'new' });
    expect(await db.prisma.page.findUnique({ where: { id: f.source.id } })).toMatchObject({ content: '[link](/new)' });
    await expect(
      actions.updatePage(f.project.id, f.source.id, { content: `${f.text}\nUnsaved text`, expectedUpdatedAt: f.source.updatedAt.toISOString() }),
    ).rejects.toMatchObject({ status: 409, code: 'page:revision_conflict' });
    expect(await db.prisma.page.findUnique({ where: { id: f.target.id } })).toMatchObject({ path: 'new' });
    expect(await db.prisma.page.findUnique({ where: { id: f.source.id } })).toMatchObject({ content: '[link](/new)' });
  }, 60_000);

  it('council: 313-page fixture measures real transaction time with no parsing under locks', async () => {
    const f = await fixture(313);
    metrics.parsesUnderLock = 0;
    const start = performance.now();
    const result = await actions.updatePage(f.project.id, f.target.id, { slug: 'new' });
    const measurement = {
      fixture: '313-pages',
      charactersPerPage: f.text.length,
      transactionMs: Math.round(metrics.transactionMs),
      requestMs: Math.round(performance.now() - start),
      parsesUnderLock: metrics.parsesUnderLock,
    };
    console.log(JSON.stringify(measurement));
    if (process.env.PAGE_ADDRESS_METRICS_FILE) writeFileSync(process.env.PAGE_ADDRESS_METRICS_FILE, JSON.stringify(measurement));
    expect(result.linksUpdated).toBe(313);
    expect(metrics.parsesUnderLock).toBe(0);
    expect(await db.prisma.page.count({ where: { projectId: f.project.id, content: { contains: '](/new#install)' } } })).toBe(313);
  }, 120_000);
});
