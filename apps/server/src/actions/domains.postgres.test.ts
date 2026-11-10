import { randomUUID } from 'node:crypto';
import type { Prisma } from '@nibleaf/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudflareCustomHostname } from '@/lib/cloudflare-saas-state';

const provider = vi.hoisted(() => ({
  get: vi.fn<(id: string) => Promise<CloudflareCustomHostname>>(),
  retry: vi.fn<(id: string) => Promise<CloudflareCustomHostname>>(),
  remove: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('@/env', () => ({ env: { NODE_ENV: 'production', APP_URL: 'https://app.example.invalid' } }));
vi.mock('@/lib/access', () => ({ optionalSiteAccess: vi.fn() }));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));
vi.mock('./sites', () => ({ invalidatePublishedSiteConfig: vi.fn() }));
vi.mock('@/lib/cloudflare-saas', async () => ({
  ...(await import('@/lib/cloudflare-saas-state')),
  cloudflareSaasEnabled: () => true,
  createCustomHostname: vi.fn(),
  createCustomHostnameRoute: vi.fn(),
  deleteCustomHostnameRoute: vi.fn(),
  getCustomHostname: provider.get,
  retryCustomHostname: provider.retry,
  deleteCustomHostname: provider.remove,
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const active = (id: string): CloudflareCustomHostname => ({ id, hostname: `${id}.example.invalid`, status: 'active', ssl: { status: 'active' } });

// Explicit opt-in against a migrated, disposable PostgreSQL database. External
// calls are mocked; domain reads, writes and transaction locks use PostgreSQL.
describe.skipIf(process.env.DOMAIN_INTEGRATION !== '1')('custom-domain concurrency in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let actions: typeof import('./domains');
  const organizationIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    actions = await import('./domains');
  });
  beforeEach(() => {
    provider.get.mockReset().mockImplementation(async (id) => active(id));
    provider.retry.mockReset().mockImplementation(async (id) => ({ ...active(id), ssl: { status: 'expired' } }));
    provider.remove.mockReset().mockResolvedValue(undefined);
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.project.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async () => {
    const label = `domain-race-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: label } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: label, slug: label } });
    const create = (suffix: string, isPrimary: boolean) =>
      db.prisma.domain.create({
        data: {
          projectId: project.id,
          domain: `${suffix}.${label}.example.invalid`,
          verificationToken: randomUUID(),
          provider: 'CLOUDFLARE_SAAS',
          providerHostnameId: suffix,
          providerData: { nibleafWorkerRouteId: `route-${suffix}` },
          verified: true,
          verifiedAt: new Date('2026-10-01T00:00:00Z'),
          dnsStatus: 'VERIFIED',
          sslStatus: 'ACTIVE',
          isPrimary,
        },
      });
    const a = await create('a', true);
    const b = await create('b', false);
    return {
      project,
      a,
      b,
      check: (id: string) => actions.verifyDomain(organization.id, project.id, id),
      promote: (id: string) => actions.setPrimaryDomain(organization.id, project.id, id),
      remove: (id: string) => actions.deleteDomain(organization.id, project.id, id),
      primaries: async () => (await db.prisma.domain.findMany({ where: { projectId: project.id, isPrimary: true } })).map((row) => row.id),
    };
  };

  const pauseCheck = () => {
    const entered = deferred<void>();
    const result = deferred<CloudflareCustomHostname>();
    provider.get.mockImplementationOnce(() => {
      entered.resolve();
      return result.promise;
    });
    return { entered: entered.promise, finish: result.resolve };
  };

  it('does not restore A as primary after B was promoted during the provider check', async () => {
    const f = await fixture();
    const providerCall = pauseCheck();
    const checking = f.check(f.a.id);
    try {
      await providerCall.entered;
      await f.promote(f.b.id);
    } finally {
      providerCall.finish(active('a'));
    }
    const result = await checking;
    expect(await f.primaries()).toEqual([f.b.id]);
    expect(result).toMatchObject({ isPrimary: false, demoted: false });
  });

  it('reports demotion from the current primary when it was promoted during a failing check', async () => {
    const f = await fixture();
    const providerCall = pauseCheck();
    const checking = f.check(f.b.id);
    try {
      await providerCall.entered;
      await f.promote(f.b.id);
    } finally {
      providerCall.finish({ ...active('b'), ssl: { status: 'expired' } });
    }
    await expect(checking).resolves.toMatchObject({ isPrimary: false, verified: false, demoted: true });
    expect(await f.primaries()).toEqual([]);
  });

  // Hold the same project lock as an in-flight status transition. Observe
  // PostgreSQL's wait queue, rather than relying on sleeps or scheduler timing.
  const holdProject = async (projectId: string) => {
    const acquired = deferred<{ tx: Prisma.TransactionClient; pid: number }>();
    const release = deferred<void>();
    const done = db.prisma.$transaction(
      async (client) => {
        await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`domain-primary:${projectId}`}, 0))::text`;
        const [row] = await client.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
        acquired.resolve({ tx: client, pid: row.pid });
        await release.promise;
      },
      { timeout: 15_000 },
    );
    return { ...(await acquired.promise), release: release.resolve, done };
  };
  const waitForWriters = async (pid: number, count: number) => {
    await expect
      .poll(
        async () => {
          const [row] = await db.prisma.$queryRaw<[{ count: number }]>`
            SELECT count(*)::int AS count FROM pg_locks waiting
            JOIN pg_locks held USING (locktype, database, classid, objid, objsubid)
            WHERE held.pid = ${pid} AND held.locktype = 'advisory' AND held.granted AND NOT waiting.granted`;
          return row.count;
        },
        { timeout: 2000 },
      )
      .toBe(count);
  };

  it('refuses promotion when verification makes the domain not ready before the promotion transaction', async () => {
    const f = await fixture();
    const providerCall = pauseCheck();
    const checking = f.check(f.b.id);
    await providerCall.entered;
    // Pause only transaction entry, leaving its real PostgreSQL implementation
    // intact. Main has already checked readiness here; the fixed action has not.
    const entered = deferred<void>();
    const release = deferred<void>();
    const transaction = db.prisma.$transaction.bind(db.prisma);
    const gate = vi.spyOn(db.prisma, '$transaction').mockImplementationOnce(async (write, options) => {
      entered.resolve();
      await release.promise;
      return transaction(write, options);
    });
    const promoting = f.promote(f.b.id).catch((error: unknown) => error);
    try {
      await entered.promise;
      providerCall.finish({ ...active('b'), ssl: { status: 'expired' } });
      await checking;
    } finally {
      providerCall.finish(active('b'));
      release.resolve();
      await promoting;
      gate.mockRestore();
    }
    expect(await promoting).toMatchObject({ code: 'domain:not_ready', status: 409, details: { id: f.b.id, domain: f.b.domain } });
    expect(await f.primaries()).toEqual([f.a.id]);
  });

  it('serializes verification writes with an in-flight project transition', async () => {
    const f = await fixture();
    const held = await holdProject(f.project.id);
    const checking = f.check(f.a.id);
    try {
      await waitForWriters(held.pid, 1);
      await held.tx.domain.updateMany({ where: { projectId: f.project.id }, data: { isPrimary: false } });
      await held.tx.domain.update({ where: { id: f.b.id }, data: { isPrimary: true } });
    } finally {
      held.release();
      await held.done;
    }
    await expect(checking).resolves.toMatchObject({ isPrimary: false });
    expect(await f.primaries()).toEqual([f.b.id]);
  });

  it('serializes removal racing promotion and leaves B as the sole primary', async () => {
    const f = await fixture();
    const held = await holdProject(f.project.id);
    const removing = f.remove(f.a.id);
    const promoting = f.promote(f.b.id);
    try {
      await waitForWriters(held.pid, 2);
    } finally {
      held.release();
      await held.done;
    }
    await expect(removing).resolves.toEqual({ id: f.a.id });
    await expect(promoting).resolves.toMatchObject({ id: f.b.id, isPrimary: true });
    expect(await f.primaries()).toEqual([f.b.id]);
    expect(await db.prisma.domain.findUnique({ where: { id: f.a.id } })).toBeNull();
  });

  it('refuses a queued promotion if removal committed first, preserving the other primary', async () => {
    const f = await fixture();
    const held = await holdProject(f.project.id);
    const promoting = f.promote(f.b.id).catch((error: unknown) => error);
    try {
      await waitForWriters(held.pid, 1);
      await held.tx.domain.delete({ where: { id: f.b.id } });
    } finally {
      held.release();
      await held.done;
    }
    expect(await promoting).toMatchObject({ code: 'database:not_found', status: 404 });
    expect(await f.primaries()).toEqual([f.a.id]);
  });

  it('leaves no primary when removal races promotion of the last domain', async () => {
    const f = await fixture();
    await f.remove(f.b.id);
    const held = await holdProject(f.project.id);
    const removing = f.remove(f.a.id);
    const promoting = f.promote(f.a.id).catch((error: unknown) => error);
    try {
      await waitForWriters(held.pid, 2);
    } finally {
      held.release();
      await held.done;
    }
    await expect(removing).resolves.toEqual({ id: f.a.id });
    const result = await promoting;
    if (result instanceof Error) expect(result).toMatchObject({ code: 'database:not_found', status: 404 });
    else if (result !== null) expect(result).toMatchObject({ id: f.a.id });
    expect(await f.primaries()).toEqual([]);
    expect(await db.prisma.domain.count({ where: { projectId: f.project.id } })).toBe(0);
  });
});
