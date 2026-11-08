import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

type Row = Record<string, unknown>;

/** A small in-memory model of the reader tables. Writes evaluate their `where`
 *  against current state, and an interactive transaction rolls back on error. */
const db = vi.hoisted(() => {
  const state = { readers: [] as Row[], invitations: [] as Row[], sessions: [] as Row[], audits: [] as Row[], providers: [] as Row[] };
  const hooks: {
    beforeReaderWrite?: () => unknown;
    onSessionCreate?: () => void;
    afterJwtVerified?: () => unknown;
    /** Errors thrown by the next interactive transactions, before their body runs. */
    transactionFailures: unknown[];
  } = { transactionFailures: [] };
  type Snapshot = { readers: Row[]; invitations: Row[]; sessions: Row[] };
  /** One rollback point per open transaction, innermost last. */
  const open: Snapshot[] = [];
  const snapshot = (): Snapshot => structuredClone({ readers: state.readers, invitations: state.invitations, sessions: state.sessions });
  /** Run a concurrent writer that commits on its own, outside the open transaction. */
  const runConcurrently = async (hook: (() => unknown) | undefined) => {
    if (!hook) return;
    await hook();
    for (let index = 0; index < open.length; index++) open[index] = snapshot();
  };
  const calls: string[] = [];
  const transactionOptions: unknown[] = [];

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([field, expected]) => {
      if (field === 'OR') return (expected as Row[]).some((alternative) => matches(row, alternative));
      const actual = row[field];
      if (expected === null) return actual === null || actual === undefined;
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        const condition = expected as Row;
        if ('gt' in condition) return actual instanceof Date && actual > (condition.gt as Date);
        if (field === 'reader') {
          const reader = state.readers.find((candidate) => candidate.id === row.readerId);
          return Boolean(reader && matches(reader, (condition.is as Row | undefined) ?? condition));
        }
        return false;
      }
      return actual === expected;
    });

  const updateMany =
    (table: Row[], label: string) =>
    async ({ where, data }: { where: Row; data: Row }) => {
      calls.push(label);
      if (label === 'reader.updateMany') await runConcurrently(hooks.beforeReaderWrite);
      const rows = table.filter((row) => matches(row, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    };

  const prisma = {
    readerInvitation: {
      findUnique: async ({ where }: { where: Row }) => {
        const invitation = state.invitations.find((row) => row.tokenHash === where.tokenHash);
        return invitation ? { ...invitation, reader: { ...state.readers.find((row) => row.id === invitation.readerId) } } : null;
      },
      updateMany: updateMany(state.invitations, 'readerInvitation.updateMany'),
    },
    reader: {
      findFirst: async ({ where }: { where: Row }) => state.readers.find((row) => matches(row, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        calls.push('reader.update');
        await runConcurrently(hooks.beforeReaderWrite);
        const row = state.readers.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('missing reader');
        Object.assign(row, data);
        return row;
      },
      updateMany: updateMany(state.readers, 'reader.updateMany'),
      create: async ({ data }: { data: Row }) => {
        calls.push('reader.create');
        const { audiences: _audiences, ...fields } = data;
        const row = { id: `reader-${state.readers.length + 1}`, revokedAt: null, ...fields };
        state.readers.push(row);
        return row;
      },
    },
    audience: { count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length },
    jwtReplay: { create: async () => ({}), deleteMany: async () => ({ count: 0 }) },
    readerSession: {
      create: async ({ data }: { data: Row }) => {
        calls.push('readerSession.create');
        hooks.onSessionCreate?.();
        const row = { id: `session-${state.sessions.length + 1}`, revokedAt: null, ...data };
        state.sessions.push(row);
        return row;
      },
      updateMany: updateMany(state.sessions, 'readerSession.updateMany'),
    },
    readerAuditLog: {
      create: async ({ data }: { data: Row }) => {
        state.audits.push(data);
        return data;
      },
    },
    jwtAccessProvider: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = state.providers.find((candidate) => candidate.projectId === where.projectId);
        return row ? structuredClone(row) : null;
      },
      updateMany: updateMany(state.providers, 'jwtAccessProvider.updateMany'),
    },
    /** Models the explicit row locks. Locks are recorded, not enforced. */
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('"jwt_access_provider"') && sql.includes('FOR SHARE')) {
        calls.push('jwtAccessProvider.lock');
        return state.providers
          .filter((row) => row.projectId === values[0] && row.enabled === true)
          .map((row) => ({ id: row.id, updatedAt: row.updatedAt }));
      }
      const table = sql.includes('"reader_invitation"') ? 'readerInvitation' : sql.includes('"reader_session"') ? 'readerSession' : null;
      // Rows are locked in id order and only a count comes back.
      if (!(table && /^\s*SELECT count\(\*\)::int AS "locked" FROM \([\s\S]*ORDER BY "id" FOR UPDATE\s*\) AS "locked_rows"\s*$/.test(sql))) {
        throw new Error(`unexpected query: ${sql}`);
      }
      calls.push(`${table}.lock`);
      return [{ locked: 0 }];
    },
    $transaction: async (input: unknown, options?: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      calls.push('$transaction');
      transactionOptions.push(options);
      if (hooks.transactionFailures.length > 0) throw hooks.transactionFailures.shift();
      open.push(snapshot());
      try {
        return await (input as (tx: unknown) => Promise<unknown>)(prisma);
      } catch (error) {
        const restore = open.at(-1) as Snapshot;
        state.readers.splice(0, state.readers.length, ...restore.readers);
        state.invitations.splice(0, state.invitations.length, ...restore.invitations);
        state.sessions.splice(0, state.sessions.length, ...restore.sessions);
        throw error;
      } finally {
        open.pop();
      }
    },
  };
  return { state, hooks, calls, transactionOptions, prisma };
});

vi.mock('@nibleaf/auth/server', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { EMAIL: 'email', SEARCH: 'search' } }));
vi.mock('@nibleaf/database', () => ({ Prisma: { JsonNull: null }, prisma: db.prisma }));
vi.mock('@/env', () => ({ env: { APP_URL: 'https://docs.example.com' } }));
vi.mock('@/lib/reader-jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reader-jwt')>();
  return {
    ...actual,
    verifyReaderJwt: async () => {
      // The configuration check has passed; a concurrent writer may commit now.
      const hook = db.hooks.afterJwtVerified;
      db.hooks.afterJwtVerified = undefined;
      await hook?.();
      return { sub: 'subject-1', email: 'reader@example.com', groups: ['staff'], jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 60 };
    },
  };
});

import { activateReaderInvitation, emergencyRevoke, jwtReaderHandoff, revokeReader } from './reader-access';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const TOKEN = 'invite-token';

const app = new Hono<HonoEnv>();
app.onError((error, ctx) =>
  error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
);
app.get('/activate', async (ctx) => ctx.json({ projectId: await activateReaderInvitation(ctx, ctx.req.query('token') ?? '') }));
const activate = () => app.request(`/activate?token=${TOKEN}`);
app.post('/jwt', async (ctx) => ctx.json(await jwtReaderHandoff(ctx, 'project-1', 'assertion')));
const exchange = () => app.request('/jwt', { method: 'POST' });

const reader = () => db.state.readers[0] as Row;
const liveSessions = () => db.state.sessions.filter((session) => session.revokedAt === null);

beforeEach(() => {
  db.state.readers.splice(0);
  db.state.invitations.splice(0);
  db.state.sessions.splice(0);
  db.state.audits.splice(0);
  db.calls.splice(0);
  db.transactionOptions.splice(0);
  db.hooks.beforeReaderWrite = undefined;
  db.hooks.onSessionCreate = undefined;
  db.hooks.afterJwtVerified = undefined;
  db.hooks.transactionFailures.splice(0);
  db.state.providers.splice(0);
  db.state.providers.push({
    id: 'provider-1',
    projectId: 'project-1',
    enabled: true,
    issuer: 'https://idp.example.com',
    subjectClaim: 'sub',
    emailClaim: 'email',
    nameClaim: 'name',
    groupsClaim: 'groups',
    claimMapping: { staff: 'audience-1' },
    sessionTtlMinutes: 60,
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  });
  db.state.readers.push({ id: 'reader-1', projectId: 'project-1', status: 'INVITED', activatedAt: null, revokedAt: null });
  db.state.invitations.push({
    id: 'invitation-1',
    projectId: 'project-1',
    readerId: 'reader-1',
    tokenHash: sha256(TOKEN),
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    revokedAt: null,
  });
});

describe('activateReaderInvitation', () => {
  it('activates the reader and issues one session cookie', async () => {
    const response = await activate();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('nibleaf_reader_project-1=');
    expect(reader()).toMatchObject({ status: 'ACTIVE', revokedAt: null });
    expect(db.state.invitations[0]?.acceptedAt).toBeInstanceOf(Date);
    expect(liveSessions()).toHaveLength(1);
  });

  it('lets a revocation that commits during activation win', async () => {
    db.hooks.beforeReaderWrite = () => {
      db.hooks.beforeReaderWrite = undefined;
      return revokeReader('project-1', 'reader-1', 'admin-1');
    };
    const response = await activate();
    await vi.waitFor(() => expect(db.state.audits.some((entry) => entry.action === 'READER_REVOKED')).toBe(true));

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(reader()).toMatchObject({ status: 'REVOKED' });
    expect(reader().revokedAt).toBeInstanceOf(Date);
    expect(liveSessions()).toHaveLength(0);
  });

  it('writes the reader row first and never clears a revocation', async () => {
    await activate();
    expect(db.calls.slice(0, 3)).toEqual(['$transaction', 'reader.updateMany', 'readerInvitation.updateMany']);
    expect(db.calls).not.toContain('reader.update');
  });

  it('keeps the invitation usable when the session cannot be issued', async () => {
    db.hooks.onSessionCreate = () => {
      throw new Error('database unavailable');
    };
    expect((await activate()).status).toBe(500);
    expect(db.state.invitations[0]?.acceptedAt).toBeNull();
    expect(reader()).toMatchObject({ status: 'INVITED', activatedAt: null });

    db.hooks.onSessionCreate = undefined;
    expect((await activate()).status).toBe(200);
    expect(liveSessions()).toHaveLength(1);
  });

  it('rejects an invitation of a revoked reader', async () => {
    Object.assign(reader(), { status: 'REVOKED', revokedAt: new Date() });
    expect((await activate()).status).toBe(404);
    expect(db.state.sessions).toHaveLength(0);
  });

  it('accepts an invitation once', async () => {
    expect((await activate()).status).toBe(200);
    expect((await activate()).status).toBe(404);
    expect(liveSessions()).toHaveLength(1);
  });
});

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: 'P2034' });

const SWEEP_LIMITS = { timeout: 60_000, maxWait: 10_000 };

describe('emergencyRevoke', () => {
  it('commits the JWT provider disable first, then sweeps invitations and sessions in one transaction', async () => {
    await emergencyRevoke('project-1', 'admin-1');
    expect(db.calls).toEqual([
      'jwtAccessProvider.updateMany',
      '$transaction',
      'readerInvitation.lock',
      'readerInvitation.updateMany',
      'readerSession.lock',
      'readerSession.updateMany',
    ]);
    expect(db.transactionOptions).toEqual([SWEEP_LIMITS]);
    expect(db.state.providers[0]?.enabled).toBe(false);
  });

  it('keeps the JWT provider disabled when the sweep fails', async () => {
    db.state.sessions.push({ id: 'session-a', projectId: 'project-1', readerId: 'reader-1', revokedAt: null });
    db.hooks.transactionFailures.push(Object.assign(new Error('Transaction already closed'), { code: 'P2028' }));
    await expect(emergencyRevoke('project-1', 'admin-1')).rejects.toMatchObject({ code: 'P2028' });
    expect(db.state.providers[0]?.enabled).toBe(false);
    expect(db.calls.filter((call) => call === '$transaction')).toHaveLength(1);
  });

  it('retries the sweep once after a deadlock', async () => {
    db.state.sessions.push({ id: 'session-a', projectId: 'project-1', readerId: 'reader-1', revokedAt: null });
    db.hooks.transactionFailures.push(deadlock());
    await expect(emergencyRevoke('project-1', 'admin-1')).resolves.toMatchObject({ sessions: 1, invitations: 1 });
    expect(db.calls.filter((call) => call === '$transaction')).toHaveLength(2);
    expect(liveSessions()).toHaveLength(0);
  });
});

describe('revokeReader', () => {
  it('locks the reader, then invitation rows by id, then session rows by id', async () => {
    await revokeReader('project-1', 'reader-1', 'admin-1');
    expect(db.transactionOptions).toEqual([SWEEP_LIMITS]);
    expect(db.calls).toEqual([
      '$transaction',
      'reader.update',
      'readerInvitation.lock',
      'readerInvitation.updateMany',
      'readerSession.lock',
      'readerSession.updateMany',
    ]);
  });

  it('retries once after a deadlock, and only once', async () => {
    db.hooks.transactionFailures.push(deadlock());
    await revokeReader('project-1', 'reader-1', 'admin-1');
    expect(reader()).toMatchObject({ status: 'REVOKED' });

    db.calls.splice(0);
    db.hooks.transactionFailures.push(deadlock(), deadlock());
    await expect(revokeReader('project-1', 'reader-1', 'admin-1')).rejects.toMatchObject({ code: 'P2034' });
    expect(db.calls.filter((call) => call === '$transaction')).toHaveLength(2);
  });

  it('does not retry other failures', async () => {
    db.hooks.transactionFailures.push(new Error('database unavailable'));
    await expect(revokeReader('project-1', 'reader-1', 'admin-1')).rejects.toThrow('database unavailable');
    expect(db.calls.filter((call) => call === '$transaction')).toHaveLength(1);
  });
});

describe('jwtReaderHandoff', () => {
  it('creates a reader and one session inside a transaction that first locks the enabled provider', async () => {
    const response = await exchange();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('nibleaf_reader_project-1=');
    expect(db.calls).toEqual(['$transaction', 'jwtAccessProvider.lock', 'reader.create', 'readerSession.create']);
    expect(liveSessions()).toEqual([expect.objectContaining({ source: 'JWT', readerId: 'reader-2' })]);
  });

  it('lets an emergency revocation that commits after the configuration check win', async () => {
    db.hooks.afterJwtVerified = () => emergencyRevoke('project-1', 'admin-1');
    const response = await exchange();
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(db.state.sessions).toHaveLength(0);
    expect(db.state.readers).toHaveLength(1);
  });

  it('lets a reader revocation that commits during the exchange win', async () => {
    Object.assign(reader(), { email: 'reader@example.com', status: 'ACTIVE' });
    db.hooks.beforeReaderWrite = () => {
      db.hooks.beforeReaderWrite = undefined;
      return revokeReader('project-1', 'reader-1', 'admin-1');
    };
    const response = await exchange();
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(reader()).toMatchObject({ status: 'REVOKED' });
    expect(liveSessions()).toHaveLength(0);
  });

  it('fails with 409 when the configuration changes after the assertion was verified', async () => {
    db.hooks.afterJwtVerified = () => {
      // An IdP key rotation: still enabled, new keys and a new updatedAt.
      Object.assign(db.state.providers[0] as Row, { publicJwks: { keys: [] }, updatedAt: new Date('2026-11-02T00:00:00.000Z') });
    };
    const response = await exchange();
    expect(response.status).toBe(409);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(db.state.sessions).toHaveLength(0);
    expect(db.state.readers).toHaveLength(1);
  });

  it('refuses a provider that is disabled', async () => {
    Object.assign(db.state.providers[0] as Row, { enabled: false });
    expect((await exchange()).status).toBe(404);
    expect(db.state.sessions).toHaveLength(0);
  });
});
