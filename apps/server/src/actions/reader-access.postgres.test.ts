import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@nibleaf/database';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

vi.mock('@nibleaf/auth/server', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { EMAIL: 'email', SEARCH: 'search' } }));
vi.mock('@nibleaf/email', () => ({ renderReaderInvitationEmail: vi.fn() }));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://docs.example.invalid' } }));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// Opt in only against a migrated test database. Every fixture is synthetic and
// cleanup is restricted to the exact organizations created by this suite.
describe.skipIf(process.env.READER_ACCESS_POSTGRES !== '1')('reader access revocation in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let readerAccess: typeof import('./reader-access');
  const organizationIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    readerAccess = await import('./reader-access');
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async () => {
    const id = `reader-access-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: id } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: id, slug: id } });
    const audience = await db.prisma.audience.create({ data: { projectId: project.id, name: 'Staff' } });
    return { project, audience };
  };

  /** Backends in this database that are waiting on a lock held by another backend. */
  const blockedBackends = async () => {
    const [row] = await db.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`;
    return row?.count ?? 0;
  };
  const waitForBlocked = async (count: number) => {
    let blocked = 0;
    for (let attempt = 0; attempt < 150 && blocked < count; attempt++) {
      blocked = await blockedBackends();
      if (blocked < count) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blocked).toBeGreaterThanOrEqual(count);
  };

  /** Hold `lock` in an open transaction until the returned release() is called. */
  const hold = async (lock: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    let release: () => void = () => undefined;
    let held: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = db.prisma.$transaction(
      async (tx) => {
        await lock(tx);
        held();
        await gate;
      },
      { timeout: 15_000 },
    );
    await Promise.race([
      acquired,
      holder.then(() => {
        throw new Error('Lock holder exited early');
      }),
    ]);
    return {
      release: async () => {
        release();
        await holder;
      },
    };
  };

  const jwtFixture = async () => {
    const { project, audience } = await fixture();
    const issuer = 'https://idp.example.invalid';
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: 'synthetic', alg: 'ES256' };
    const provider = await db.prisma.jwtAccessProvider.create({
      data: {
        projectId: project.id,
        enabled: true,
        issuer,
        audience: 'docs',
        publicJwks: { keys: [jwk] } as Prisma.InputJsonValue,
        claimMapping: { staff: audience.id },
      },
    });
    const assertion = await new SignJWT({ groups: ['staff'], email: `reader-${randomUUID()}@example.invalid` })
      .setProtectedHeader({ alg: 'ES256', kid: 'synthetic' })
      .setIssuer(issuer)
      .setAudience('docs')
      .setSubject(`subject-${randomUUID()}`)
      .setIssuedAt()
      .setExpirationTime('2m')
      .setJti(randomUUID())
      .sign(privateKey);

    const app = new Hono<HonoEnv>();
    app.onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: error.message }, 500)));
    app.post('/jwt', async (ctx) => ctx.json(await readerAccess.jwtReaderHandoff(ctx, project.id, assertion)));
    return { project, provider, exchange: () => app.request('/jwt', { method: 'POST' }) };
  };

  it('completes a valid JWT exchange with exactly one session', async () => {
    // The exchange compares the locked row's updatedAt with the Prisma read of
    // the same row, so this also proves the two agree on the real driver.
    const { project, exchange } = await jwtFixture();
    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(`nibleaf_reader_${project.id}=`);
    const sessions = await db.prisma.readerSession.findMany({ where: { projectId: project.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: 'JWT', revokedAt: null });
  });

  it('keeps the JWT provider disabled when the emergency sweep fails', async () => {
    const { project, provider } = await jwtFixture();
    const reader = await db.prisma.reader.create({ data: { projectId: project.id, email: `reader-${randomUUID()}@example.invalid` } });
    const session = await db.prisma.readerSession.create({
      data: { projectId: project.id, readerId: reader.id, tokenHash: sha256(randomUUID()), expiresAt: new Date(Date.now() + 60_000) },
    });
    const sessionLock = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "reader_session" WHERE "id" = ${session.id} FOR UPDATE`);
    const revocation = readerAccess.emergencyRevoke(project.id, 'admin').then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await waitForBlocked(1);
      // Fail the sweep while it waits on the held session row.
      await db.prisma.$queryRaw`
        SELECT pg_cancel_backend(pid) FROM pg_stat_activity
        WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`;
      expect(await revocation).not.toBeNull();
    } finally {
      await sessionLock.release();
    }

    expect(await db.prisma.jwtAccessProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ enabled: false });
    expect(await db.prisma.readerSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ revokedAt: null });
  });

  it('reports a real deadlock in the shape the revocation retry matches', async () => {
    const { project } = await fixture();
    const reader = await db.prisma.reader.create({ data: { projectId: project.id, email: `reader-${randomUUID()}@example.invalid` } });
    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        db.prisma.readerSession.create({
          data: { projectId: project.id, readerId: reader.id, tokenHash: sha256(randomUUID()), expiresAt: new Date(Date.now() + 60_000) },
        }),
      ),
    );
    if (!(first && second)) throw new Error('Missing session fixture');
    let firstLocked: () => void = () => undefined;
    let secondLocked: () => void = () => undefined;
    const firstHeld = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });
    const secondHeld = new Promise<void>((resolve) => {
      secondLocked = resolve;
    });
    // Opposite lock orders: a raw row lock in one transaction, an update in the other.
    const left = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT count(*)::int FROM (SELECT 1 FROM "reader_session" WHERE "id" = ${first.id} FOR UPDATE) AS "locked_rows"`;
        firstLocked();
        await secondHeld;
        await tx.readerSession.updateMany({ where: { id: second.id }, data: { lastUsedAt: new Date() } });
      },
      { timeout: 15_000 },
    );
    const right = db.prisma.$transaction(
      async (tx) => {
        await firstHeld;
        await tx.readerSession.updateMany({ where: { id: second.id }, data: { lastUsedAt: new Date() } });
        secondLocked();
        await waitForBlocked(1);
        await tx.$queryRaw`SELECT count(*)::int FROM (SELECT 1 FROM "reader_session" WHERE "id" = ${first.id} FOR UPDATE) AS "locked_rows"`;
      },
      { timeout: 15_000 },
    );
    const outcomes = await Promise.allSettled([left, right]);
    const victims = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason as unknown] : []));

    expect(victims).toHaveLength(1);
    expect(victims[0]).toMatchObject({ code: 'P2034' });
    expect(readerAccess.isRetryableConflict(victims[0])).toBe(true);
  });

  it('fails a JWT exchange whose provider is disabled while the exchange is in flight', async () => {
    const { project, provider, exchange } = await jwtFixture();
    // The first statement of an emergency revocation, held uncommitted.
    const revocation = await hold((tx) => tx.$executeRaw`UPDATE "jwt_access_provider" SET "enabled" = false WHERE "id" = ${provider.id}`);
    const pending = exchange();
    try {
      await waitForBlocked(1);
    } finally {
      await revocation.release();
    }
    const response = await pending;

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await db.prisma.readerSession.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('fails a JWT exchange with 409 when the provider configuration changes while it is in flight', async () => {
    const { project, provider, exchange } = await jwtFixture();
    // A key rotation that keeps the provider enabled, held uncommitted.
    const rotation = await hold(
      (tx) =>
        tx.$executeRaw`UPDATE "jwt_access_provider" SET "publicJwks" = ${JSON.stringify({ keys: [] })}::jsonb, "updatedAt" = now() WHERE "id" = ${provider.id}`,
    );
    const pending = exchange();
    try {
      await waitForBlocked(1);
    } finally {
      await rotation.release();
    }
    const response = await pending;

    expect(response.status).toBe(409);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await db.prisma.readerSession.count({ where: { projectId: project.id } })).toBe(0);
  });

  /** Count interactive transactions, so a retried revocation cannot hide a deadlock. */
  const countTransactions = () => {
    const spy = vi.spyOn(db.prisma, '$transaction');
    return { count: () => spy.mock.calls.length, restore: () => spy.mockRestore() };
  };

  const invitedReader = async () => {
    const { project } = await fixture();
    const token = randomUUID();
    const reader = await db.prisma.reader.create({ data: { projectId: project.id, email: `reader-${randomUUID()}@example.invalid` } });
    await db.prisma.readerInvitation.create({
      data: { projectId: project.id, readerId: reader.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000), createdById: 'admin' },
    });
    const app = new Hono<HonoEnv>();
    app.onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: error.message }, 500)));
    app.get('/activate', async (ctx) => ctx.json({ projectId: await readerAccess.activateReaderInvitation(ctx, token) }));
    return { project, reader, activate: () => app.request('/activate') };
  };

  it.each([
    { first: 'activation', activationStatus: 200 },
    { first: 'revocation', activationStatus: 404 },
  ])('serializes activation and reader revocation on the reader row ($first queued first)', async ({ first, activationStatus }) => {
    const { project, reader, activate } = await invitedReader();
    const transactions = countTransactions();
    const readerLock = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "reader" WHERE "id" = ${reader.id} FOR UPDATE`);
    let activation: Response | Promise<Response> | undefined;
    let revocation: Promise<unknown> | undefined;
    try {
      if (first === 'activation') {
        activation = activate();
        await waitForBlocked(1);
        revocation = readerAccess.revokeReader(project.id, reader.id, 'admin');
      } else {
        revocation = readerAccess.revokeReader(project.id, reader.id, 'admin');
        await waitForBlocked(1);
        activation = activate();
      }
      await waitForBlocked(2);
    } finally {
      await readerLock.release();
    }
    const [activated, revoked] = await Promise.allSettled([activation, revocation]);

    expect(activated.status === 'fulfilled' && activated.value?.status).toBe(activationStatus);
    expect(revoked.status).toBe('fulfilled');
    // The lock holder, the activation and one revocation: no retry ran.
    expect(transactions.count()).toBe(3);
    transactions.restore();
    expect(await db.prisma.reader.findUniqueOrThrow({ where: { id: reader.id } })).toMatchObject({ status: 'REVOKED' });
    expect(await db.prisma.readerSession.count({ where: { projectId: project.id, revokedAt: null } })).toBe(0);
  });

  it('locks several sessions in id order in both revocation paths', async () => {
    const { project } = await fixture();
    const reader = await db.prisma.reader.create({ data: { projectId: project.id, email: `reader-${randomUUID()}@example.invalid` } });
    // Insert the higher id first, so physical (scan) order is the reverse of id order.
    const higher = `zz-${randomUUID()}`;
    const lower = `aa-${randomUUID()}`;
    for (const id of [higher, lower]) {
      await db.prisma.readerSession.create({
        data: { id, projectId: project.id, readerId: reader.id, tokenHash: sha256(randomUUID()), expiresAt: new Date(Date.now() + 60_000) },
      });
    }
    /** True when no other transaction holds a lock on the row. */
    const unlocked = (id: string) =>
      db.prisma
        .$transaction((tx) => tx.$queryRaw`SELECT "id" FROM "reader_session" WHERE "id" = ${id} FOR UPDATE NOWAIT`)
        .then(() => true)
        .catch(() => false);

    const transactions = countTransactions();
    const lowerLock = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "reader_session" WHERE "id" = ${lower} FOR UPDATE`);
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      const revoke = readerAccess.revokeReader(project.id, reader.id, 'admin');
      await waitForBlocked(1);
      // Waiting on the lower id, the revocation must not hold the higher one yet.
      expect(await unlocked(higher)).toBe(true);
      const emergency = readerAccess.emergencyRevoke(project.id, 'admin');
      await waitForBlocked(2);
      expect(await unlocked(higher)).toBe(true);
      outcomes = await Promise.allSettled([revoke, emergency, lowerLock.release().then(() => undefined)]);
    } catch (error) {
      await lowerLock.release();
      throw error;
    }

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    // The lock holder, two probes, and one transaction per revocation: no retry ran.
    expect(transactions.count()).toBe(5);
    transactions.restore();
    expect(await db.prisma.readerSession.count({ where: { projectId: project.id, revokedAt: null } })).toBe(0);
  });

  it('runs a reader revocation and an emergency revocation concurrently without deadlocking', async () => {
    const { project } = await fixture();
    const reader = await db.prisma.reader.create({ data: { projectId: project.id, email: `reader-${randomUUID()}@example.invalid` } });
    await db.prisma.readerInvitation.create({
      data: {
        projectId: project.id,
        readerId: reader.id,
        tokenHash: sha256(randomUUID()),
        expiresAt: new Date(Date.now() + 60_000),
        createdById: 'admin',
      },
    });
    const session = await db.prisma.readerSession.create({
      data: { projectId: project.id, readerId: reader.id, tokenHash: sha256(randomUUID()), expiresAt: new Date(Date.now() + 60_000) },
    });

    // Hold the session row so both revocations queue on it in a known order.
    const transactions = countTransactions();
    const sessionLock = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "reader_session" WHERE "id" = ${session.id} FOR UPDATE`);
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      const revoke = readerAccess.revokeReader(project.id, reader.id, 'admin');
      await waitForBlocked(1);
      const emergency = readerAccess.emergencyRevoke(project.id, 'admin');
      await waitForBlocked(2);
      outcomes = await Promise.allSettled([revoke, emergency, sessionLock.release().then(() => undefined)]);
    } catch (error) {
      await sessionLock.release();
      throw error;
    }

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    // The lock holder and one transaction per revocation: no retry ran.
    expect(transactions.count()).toBe(3);
    transactions.restore();
    expect(await db.prisma.readerSession.count({ where: { projectId: project.id, revokedAt: null } })).toBe(0);
    expect(await db.prisma.readerInvitation.count({ where: { projectId: project.id, revokedAt: null } })).toBe(0);
  });
});
