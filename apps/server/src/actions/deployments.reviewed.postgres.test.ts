import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(async () => undefined), QueueNames: { PUBLISH: 'publish', SEARCH: 'search' } }));
vi.mock('../../../worker/src/lib/publish-activation', () => ({ recordPublishReady: vi.fn(async () => undefined) }));
vi.mock('../../../worker/src/lib/notify', () => ({ notifyDeployment: vi.fn(async () => undefined) }));

describe.skipIf(process.env.REVIEWED_PUBLISH_POSTGRES !== '1')('reviewed publish input in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let actions: typeof import('./deployments');
  let worker: {
    handlePublishJobs: (job: {
      data: { deploymentId: string; projectId: string; auto: false };
      opts: { attempts: number };
      attemptsMade: number;
    }) => Promise<{ pages: number }>;
  };
  const id = `reviewed-${randomUUID()}`;
  let pageId: string;
  beforeAll(async () => {
    vi.stubEnv('ANALYTICS_MODE', 'disabled');
    db = await import('@nibleaf/database');
    actions = await import('./deployments');
    // Resolve at runtime: server declaration builds must not emit worker declarations beside its sources.
    worker = await import(new URL('../../../worker/src/processors/publish.ts', import.meta.url).href);
    await db.prisma.user.create({ data: { id, name: 'Synthetic reviewer', email: `${id}@example.invalid` } });
    await db.prisma.organization.create({ data: { id, name: id } });
    await db.prisma.project.create({ data: { id, name: id, slug: id, organizationId: id } });
    const branch = await db.prisma.branch.create({ data: { projectId: id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: id, code: 'en', label: 'English', isDefault: true } });
    const page = await db.prisma.page.create({
      data: {
        projectId: id,
        branchId: branch.id,
        languageId: language.id,
        title: 'Reviewed guide',
        slug: 'guide',
        path: 'guide',
        content: 'Reviewed content',
      },
    });
    pageId = page.id;
  }, 120_000);
  afterAll(async () => {
    await db?.prisma.project.deleteMany({ where: { organizationId: id } });
    await db?.prisma.organization.deleteMany({ where: { id } });
    await db?.prisma.platformEvent.deleteMany({ where: { projectId: id } });
    await db?.prisma.user.deleteMany({ where: { id } });
    await db?.prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it('stores the approved JSONB input and builds it after a real late page update', async () => {
    const { reviewedStateHash } = await actions.getPendingChanges(id);
    const deployment = await actions.createDeployment(id, id, id, { reviewedStateHash });
    const pending = await db.prisma.deployment.findUniqueOrThrow({ where: { id: deployment.id } });
    expect(pending.approvedSnapshot).toMatchObject({ pages: [expect.objectContaining({ content: 'Reviewed content' })] });
    await db.prisma.page.update({ where: { id: pageId }, data: { content: 'Unreviewed late edit' } });
    const job = { data: { deploymentId: deployment.id, projectId: id, auto: false }, opts: { attempts: 1 }, attemptsMade: 0 } as Parameters<
      typeof worker.handlePublishJobs
    >[0];
    await expect(worker.handlePublishJobs(job)).resolves.toEqual({ pages: 1 });
    const published = await db.prisma.deployment.findUniqueOrThrow({ where: { id: deployment.id } });
    expect(published.status).toBe('READY');
    expect(published.snapshot).toMatchObject({ pages: [expect.objectContaining({ content: 'Reviewed content' })] });
    expect(published.approvedSnapshot).toBeNull();
  });

  it('refuses a stale dashboard review before allocating another database row', async () => {
    const reviewed = await actions.getPendingChanges(id);
    const before = await db.prisma.deployment.count({ where: { projectId: id } });
    await db.prisma.page.update({ where: { id: pageId }, data: { content: 'Another unreviewed edit' } });
    await expect(actions.createDeployment(id, id, id, { reviewedStateHash: reviewed.reviewedStateHash })).rejects.toMatchObject({
      code: 'mcp:preview_stale',
    });
    expect(await db.prisma.deployment.count({ where: { projectId: id } })).toBe(before);
  });
});
