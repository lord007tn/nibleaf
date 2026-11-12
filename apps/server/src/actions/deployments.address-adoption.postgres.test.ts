import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(async () => undefined), QueueNames: { PUBLISH: 'publish', SEARCH: 'search' } }));

// Runs between a publish reading the draft pages and building its snapshot,
// that is, before the deployment row exists. buildSnapshot is synchronous;
// getCurrentSnapshot returns its result from an async function, so returning a
// promise here delays the publish without changing what it receives.
const hooks = vi.hoisted(() => ({ afterSnapshotRead: undefined as (() => Promise<void>) | undefined }));
vi.mock('@nibleaf/shared/site', async (original) => {
  const actual = await original<typeof import('@nibleaf/shared/site')>();
  return {
    ...actual,
    buildSnapshot: (...args: Parameters<typeof actual.buildSnapshot>) => {
      const hook = hooks.afterSnapshotRead;
      if (!hook) return actual.buildSnapshot(...args);
      hooks.afterSnapshotRead = undefined;
      return hook().then(() => actual.buildSnapshot(...args));
    },
  };
});

describe.skipIf(process.env.PUBLISH_ADOPTION_POSTGRES !== '1')('publish and first-title address adoption in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let pages: typeof import('./pages');
  let deployments: typeof import('./deployments');
  const organizations: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('ANALYTICS_MODE', 'disabled');
    db = await import('@nibleaf/database');
    pages = await import('./pages');
    deployments = await import('./deployments');
  }, 120_000);
  afterEach(() => {
    hooks.afterSnapshotRead = undefined;
  });
  afterAll(async () => {
    await db?.prisma.project.deleteMany({ where: { organizationId: { in: organizations } } });
    await db?.prisma.platformEvent.deleteMany({ where: { userId: { in: users } } });
    await db?.prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await db?.prisma.user.deleteMany({ where: { id: { in: users } } });
    await db?.prisma.$disconnect();
    vi.unstubAllEnvs();
  }, 60_000);

  const fixture = async (extraPages = 0, content = 'Body') => {
    const id = `adoption-${randomUUID()}`;
    await db.prisma.user.create({ data: { id, name: 'Synthetic publisher', email: `${id}@example.invalid` } });
    users.push(id);
    await db.prisma.organization.create({ data: { id, name: id } });
    organizations.push(id);
    await db.prisma.project.create({ data: { id, name: id, slug: id, organizationId: id } });
    const branch = await db.prisma.branch.create({ data: { projectId: id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: id, code: 'en', label: 'English', isDefault: true } });
    const base = { projectId: id, branchId: branch.id, languageId: language.id, content };
    const untitled = await db.prisma.page.create({ data: { ...base, title: '', slug: 'untitled-2', path: 'untitled-2', position: 0 } });
    const titled = await db.prisma.page.create({ data: { ...base, title: 'Introduction', slug: 'introduction', path: 'introduction', position: 1 } });
    if (extraPages > 0) {
      await db.prisma.page.createMany({
        data: Array.from({ length: extraPages }, (_, index) => ({
          ...base,
          title: `Topic ${index}`,
          slug: `topic-${index}`,
          path: `topic-${index}`,
          position: index + 2,
        })),
      });
    }
    return { id, untitled, titled };
  };

  /** Wait, without sleeping, until `work` settles or another session waits on
   *  a lock in a statement matching `statement` (a LIKE pattern). Each round
   *  trip is a real query. */
  const settledOrWaiting = async (work: Promise<unknown>, statement: string): Promise<'settled' | 'waiting'> => {
    let settled = false;
    const done = work.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    while (!settled) {
      const [row] = await db.prisma.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${statement}`;
      if ((row?.waiting ?? 0) > 0) return 'waiting';
    }
    await done;
    return 'settled';
  };

  /** The page's address in the input a deployment will publish, its draft
   *  address, and whether a redirect leads from the first to the second. */
  const addresses = async (projectId: string, deploymentId: string, pageId: string) => {
    const row = await db.prisma.deployment.findUniqueOrThrow({ where: { id: deploymentId }, select: { approvedSnapshot: true } });
    const snapshot = row.approvedSnapshot as unknown as import('@nibleaf/shared/site').SiteSnapshot;
    const published = snapshot.pages.find((page) => page.id === pageId)?.path;
    const draft = (await db.prisma.page.findUniqueOrThrow({ where: { id: pageId } })).path;
    const project = await db.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { config: true } });
    const redirects = ((project.config as { redirects?: Array<{ from: string; to: string }> } | null)?.redirects ?? []).filter(
      (rule) => rule.from === `/${published}` && rule.to === `/${draft}`,
    );
    return { published, draft, divergedWithoutRedirect: published !== draft && redirects.length === 0 };
  };

  it('a first-title adoption between a publish reading the drafts and creating its row waits for the row, so the page goes live where its draft is', async () => {
    const f = await fixture();
    let adoption: Promise<{ path: string; title: string }> | undefined;
    let during: 'settled' | 'waiting' | undefined;
    hooks.afterSnapshotRead = async () => {
      adoption = pages.updatePage(f.id, f.untitled.id, { title: 'Getting started' });
      during = await settledOrWaiting(adoption, '%FROM "project"%FOR NO KEY UPDATE%');
    };
    const deployment = await deployments.createDeployment(f.id, f.id, f.id, {});
    const adopted = await adoption;
    expect(await addresses(f.id, deployment.id, f.untitled.id)).toEqual({
      published: 'untitled-2',
      draft: 'untitled-2',
      divergedWithoutRedirect: false,
    });
    expect(during).toBe('waiting');
    // The title is saved; the address stays, because a publish is now pending.
    expect(adopted).toMatchObject({ title: 'Getting started', path: 'untitled-2' });
  }, 60_000);

  it('an adoption in progress when a publish takes the project lock commits first, and the publish reads it', async () => {
    const f = await fixture();
    // Hold one page row so the adoption stops after taking the project lock.
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((settle) => {
        resolve = settle;
      });
      return { promise, resolve };
    };
    const holding = deferred();
    const released = deferred();
    const release = () => released.resolve();
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "page" WHERE id = ${f.titled.id} FOR UPDATE`;
        holding.resolve();
        await released.promise;
      },
      { timeout: 60_000 },
    );
    await holding.promise;
    let adoption: ReturnType<typeof pages.updatePage> | undefined;
    let publish: ReturnType<typeof deployments.createDeployment> | undefined;
    try {
      adoption = pages.updatePage(f.id, f.untitled.id, { title: 'Getting started' });
      expect(await settledOrWaiting(adoption, '%FROM "page"%FOR NO KEY UPDATE%')).toBe('waiting');
      // The publish waits for the adoption's project lock before it reads the drafts.
      publish = deployments.createDeployment(f.id, f.id, f.id, {});
      expect(await settledOrWaiting(publish, '%FROM "project"%FOR SHARE%')).toBe('waiting');
    } finally {
      release();
      await holder;
      await Promise.allSettled([adoption, publish]);
    }
    const [adopted, deployment] = await Promise.all([adoption, publish]);
    expect(adopted.path).toBe('getting-started');
    expect(await addresses(f.id, deployment.id, f.untitled.id)).toEqual({
      published: 'getting-started',
      draft: 'getting-started',
      divergedWithoutRedirect: false,
    });
  }, 60_000);

  it('a reviewed input read before a first-title adoption is refused instead of going live at the old address', async () => {
    const f = await fixture();
    const reviewed = await deployments.getCurrentSnapshot(f.id);
    const adopted = await pages.updatePage(f.id, f.untitled.id, { title: 'Getting started' });
    expect(adopted.path).toBe('getting-started');
    await expect(deployments.createDeployment(f.id, f.id, f.id, {}, undefined, reviewed)).rejects.toMatchObject({ code: 'mcp:preview_stale' });
    expect(await db.prisma.deployment.count({ where: { projectId: f.id } })).toBe(0);
  }, 60_000);

  it('a reviewed input stays publishable when only a live page moved since: that move recorded a redirect', async () => {
    const f = await fixture();
    const live = await deployments.getCurrentSnapshot(f.id);
    await db.prisma.deployment.create({
      data: { projectId: f.id, version: 1, status: 'READY', snapshot: live as unknown as import('@nibleaf/database').Prisma.InputJsonValue },
    });
    const reviewed = await deployments.getCurrentSnapshot(f.id);
    expect((await pages.updatePage(f.id, f.titled.id, { slug: 'overview' })).path).toBe('overview');
    const deployment = await deployments.createDeployment(f.id, f.id, f.id, {}, undefined, reviewed);
    expect(await addresses(f.id, deployment.id, f.titled.id)).toEqual({
      published: 'introduction',
      draft: 'overview',
      divergedWithoutRedirect: false,
    });
  }, 60_000);

  it('a save that does not move a page is not held while a publish reads the drafts', async () => {
    const f = await fixture();
    let during: 'settled' | 'waiting' | undefined;
    hooks.afterSnapshotRead = async () => {
      during = await settledOrWaiting(
        pages.updatePage(f.id, f.titled.id, { title: 'Overview', content: 'Edited while publishing' }),
        '%FOR NO KEY UPDATE%',
      );
    };
    await deployments.createDeployment(f.id, f.id, f.id, {});
    expect(during).toBe('settled');
    expect(await db.prisma.page.findUniqueOrThrow({ where: { id: f.titled.id } })).toMatchObject({ title: 'Overview', path: 'introduction' });
  }, 60_000);

  // Publish and save latency under concurrent saves (PUBLISH_LOCK_METRICS=1).
  // Measured, not asserted: the numbers go in the pull request.
  it.runIf(process.env.PUBLISH_LOCK_METRICS === '1')(
    'measures publish and save latency while saves run concurrently',
    async () => {
      const f = await fixture(200, `${'Documentation paragraph. '.repeat(80)}\n`);
      const topics = await db.prisma.page.findMany({ where: { projectId: f.id, slug: { startsWith: 'topic-' } }, orderBy: { position: 'asc' } });
      const timed = async (into: number[], work: () => Promise<unknown>) => {
        const start = performance.now();
        await work();
        into.push(performance.now() - start);
      };
      const rounds = Number(process.env.PUBLISH_LOCK_METRICS_ROUNDS ?? 60);
      // Publish `rounds` times while `savers` keep saving; the savers stop
      // after the last publish.
      const whileSaving = async (savers: Array<(running: () => boolean) => Promise<void>>) => {
        const publishes: number[] = [];
        let publishing = true;
        const running = savers.map((save) => save(() => publishing));
        try {
          for (let round = 0; round < rounds; round++) {
            await timed(publishes, () => deployments.createDeployment(f.id, f.id, f.id, {}));
          }
        } finally {
          publishing = false;
          await Promise.all(running);
        }
        return publishes;
      };
      const titleSaves: number[] = [];
      const titleLoop = (offset: number) => async (running: () => boolean) => {
        for (let index = 0; running(); index++) {
          const page = topics[(index * 2 + offset) % topics.length];
          if (page) await timed(titleSaves, () => pages.updatePage(f.id, page.id, { title: `Topic ${offset}.${index}` }));
        }
      };
      // Address changes conflict with any other page saving while their links
      // are prepared, so they run in their own phase, against publishes only.
      const structuralSaves: number[] = [];
      let addressConflicts = 0;
      const structuralLoop = async (running: () => boolean) => {
        for (let index = 0; running(); index++) {
          await timed(structuralSaves, () => pages.updatePage(f.id, f.titled.id, { slug: `introduction-${index % 2}` })).catch((error: unknown) => {
            if ((error as { code?: string }).code !== 'page:address_conflict') throw error;
            addressConflicts++;
          });
        }
      };
      const publishesWithTitleSaves = await whileSaving([titleLoop(0), titleLoop(1)]);
      const publishesWithAddressChanges = await whileSaving([structuralLoop]);
      const percentile = (values: number[], p: number) => {
        const sorted = [...values].sort((a, b) => a - b);
        return Math.round((sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0) * 10) / 10;
      };
      const summary = (values: number[]) => ({ count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
      const measurement = {
        fixture: '202 pages',
        publishWithTitleSaves: summary(publishesWithTitleSaves),
        titleSave: summary(titleSaves),
        publishWithAddressChanges: summary(publishesWithAddressChanges),
        addressChange: summary(structuralSaves),
        addressConflicts,
      };
      console.log(JSON.stringify(measurement));
      if (process.env.PUBLISH_LOCK_METRICS_FILE) writeFileSync(process.env.PUBLISH_LOCK_METRICS_FILE, JSON.stringify(measurement));
      expect(publishesWithTitleSaves).toHaveLength(rounds);
      expect(publishesWithAddressChanges).toHaveLength(rounds);
    },
    300_000,
  );
});
