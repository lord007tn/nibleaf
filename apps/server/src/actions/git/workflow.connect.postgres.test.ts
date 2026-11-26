import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const remote = vi.hoisted(() => {
  process.env.GIT_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  return { verify: async (_repository: string): Promise<void> => undefined };
});
vi.mock('@nibleaf/bullmq', () => ({
  createJob: vi.fn(),
  QueueNames: { GIT: 'git' },
  QUEUE_CONFIGS: { git: { operationClaimTimeout: 12 * 60 * 1000 } },
}));
// No GitHub traffic. The action, AES-GCM crypto, snapshots, ledger, audit and
// transaction/locking boundaries below use their real implementations.
vi.mock('./github', () => ({
  GitHubProvider: class {
    verifyWriteAccess = (repository: string) => remote.verify(repository);
    getBranchSha = async (_repository: string, branch: string) => (branch === 'main' ? 'fictional-base' : 'fictional-head');
    listThemeRepositoryFiles = async (repository: string, _ref: string, contentPath: string) => [
      {
        path: `${contentPath ? `${contentPath}/` : ''}${repository.split('/')[1]}.md`,
        sha: 'fictional-blob',
        content: '# Fictional\n',
      },
    ];
  },
}));

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

// Use only a migrated, owned disposable PostgreSQL database. Cleanup deletes
// only this suite's exact fictional organizations, never resets a database.
describe.skipIf(process.env.DATA_INTEGRITY_POSTGRES !== '1')('Git connection saves in PostgreSQL with real crypto', () => {
  let db: typeof import('@nibleaf/database');
  let workflow: typeof import('./workflow');
  let crypto: typeof import('./crypto');
  let handlers: typeof import('../../modules/app/git/handlers')['default'];
  const organizations: string[] = [];
  const users: string[] = [];
  const token = 'fictional-lane794-token-0001';
  const replacement = 'fictional-lane794-token-0002';

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    workflow = await import('./workflow');
    crypto = await import('./crypto');
    handlers = (await import('../../modules/app/git/handlers')).default;
  }, 120_000);
  beforeEach(() => {
    remote.verify = async () => undefined;
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.project.deleteMany({ where: { organizationId: { in: organizations } } });
      await db.prisma.organization.deleteMany({ where: { id: { in: organizations } } });
      await db.prisma.user.deleteMany({ where: { id: { in: users } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async (connected = true, missingSecret = false) => {
    const name = `fictional-lane794-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name } });
    organizations.push(organization.id);
    const project = await db.prisma.project.create({ data: { name, slug: name, organizationId: organization.id } });
    const branch = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const language = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const connection = connected
      ? await db.prisma.gitConnection.create({
          data: {
            projectId: project.id,
            repository: 'fictional/original',
            headBranch: 'nibleaf/docs',
            createdById: 'fictional-author',
            credentialEncrypted: crypto.encryptGitSecret(token),
            credentialFingerprint: crypto.gitCredentialFingerprint(token),
            webhookSecretEncrypted: missingSecret ? null : crypto.encryptGitSecret('fictional-webhook-0001'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        })
      : null;
    if (connection)
      await db.prisma.gitFileState.create({
        data: {
          connectionId: connection.id,
          path: 'original.md',
          branchId: branch.id,
          languageId: language.id,
          baseContent: '# Original',
          baseExists: true,
          ownership: 'SHARED',
        },
      });
    return { project, branch, language, connection };
  };
  const input = (repository = 'fictional/updated') => ({
    repository,
    baseBranch: 'refs/heads/main',
    headBranch: ' nibleaf/docs ',
    contentPath: 'docs/',
  });
  const save = (projectId: string, repository: string, nextToken?: string) =>
    workflow.connectGitHub(projectId, 'fictional-author', {
      ...input(repository),
      ...(nextToken !== undefined ? { token: nextToken } : {}),
    });
  const read = (projectId: string) =>
    db.prisma.gitConnection.findUniqueOrThrow({ where: { projectId }, include: { files: true, auditEvents: true } });
  const routeFor = (user: { id: string; name: string; email: string }) => {
    const app = new Hono<HonoEnv>();
    app.use('*', contextStorage());
    app.use('*', async (ctx, next) => {
      ctx.set('user', user);
      await next();
    });
    app.onError((error, ctx) =>
      error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { code: 'http:internal' } }, 500),
    );
    return app.route('/projects/:projectId/git', handlers);
  };
  const gated = () => {
    const seen = [deferred(), deferred()];
    const go = [deferred(), deferred()];
    let count = 0;
    remote.verify = async () => {
      const index = count++;
      seen[index]?.resolve();
      await go[index]?.promise;
    };
    return { seen, go };
  };

  it.each([false, true])(
    'accepts only one overlapping existing save (missing secret: %s), without merging credentials, ledger or audit',
    async (missingSecret) => {
      const setup = await fixture(true, missingSecret);
      const gates = gated();
      const first = save(setup.project.id, 'fictional/first', replacement);
      await gates.seen[0]?.promise;
      const second = save(setup.project.id, 'fictional/second', '');
      const outcome = second.then(
        () => ({ status: 200 }),
        (error: unknown) => ({ status: (error as { status?: number }).status }),
      );
      await gates.seen[1]?.promise;
      gates.go[0]?.resolve();
      let accepted: Awaited<ReturnType<typeof save>> | undefined;
      try {
        accepted = await first;
        // Force timestamp equality even across distinct committed row versions.
        await db.prisma.gitConnection.update({ where: { projectId: setup.project.id }, data: { updatedAt: setup.connection?.updatedAt } });
      } finally {
        gates.go[1]?.resolve();
      }
      expect((await outcome).status).toBe(409);
      const row = await read(setup.project.id);
      expect(row.repository).toBe('fictional/first');
      expect(crypto.decryptGitSecret(row.credentialEncrypted ?? '') === replacement).toBe(true);
      if (missingSecret) {
        expect(crypto.decryptGitSecret(row.webhookSecretEncrypted ?? '') === accepted?.webhookSecret).toBe(true);
      } else {
        expect(row.webhookSecretEncrypted === setup.connection?.webhookSecretEncrypted).toBe(true);
      }
      expect(row.files.map((file) => file.path)).toEqual(['docs/first.md']);
      expect(row.auditEvents.map((event) => event.action)).toEqual(['connection.updated']);
    },
  );

  it('returns one matching stored credential and secret, and one honest conflict for simultaneous first connects', async () => {
    const setup = await fixture(false);
    const gates = gated();
    const results = Promise.allSettled([save(setup.project.id, 'fictional/first', token), save(setup.project.id, 'fictional/second', replacement)]);
    await Promise.all(gates.seen.map((gate) => gate.promise));
    for (const gate of gates.go) gate.resolve();
    const settled = await results;
    expect(settled.filter((result) => result.status === 'fulfilled').length).toBe(1);
    const rejected = settled.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409);
    const accepted = settled.find((result) => result.status === 'fulfilled');
    const row = await read(setup.project.id);
    if (accepted?.status !== 'fulfilled') throw new Error('Expected one accepted first connection');
    expect(row.repository).toBe(accepted.value.connection.repository);
    expect(crypto.decryptGitSecret(row.webhookSecretEncrypted ?? '') === accepted.value.webhookSecret).toBe(true);
    const expectedToken = accepted.value.connection.repository === 'fictional/first' ? token : replacement;
    expect(crypto.decryptGitSecret(row.credentialEncrypted ?? '') === expectedToken).toBe(true);
    expect(row.files.length).toBe(1);
    expect(row.auditEvents.map((event) => event.action)).toEqual(['connection.created']);
  });

  it('rechecks the version after a blocked row writer commits, even with the same updatedAt', async () => {
    const setup = await fixture();
    const held = deferred();
    const release = deferred();
    let blockerPid = 0;
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.gitConnection.update({
          where: { projectId: setup.project.id },
          data: { repository: 'fictional/winner', updatedAt: setup.connection?.updatedAt },
        });
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        blockerPid = backend?.pid ?? 0;
        held.resolve();
        await release.promise;
      },
      { timeout: 20_000 },
    );
    await held.promise;
    const pending = save(setup.project.id, 'fictional/loser').then(
      () => 200,
      (error: unknown) => (error as { status?: number }).status,
    );
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
        const [row] = await db.prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND ${blockerPid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        blocked = row?.blocked ?? false;
        if (!blocked) await new Promise((done) => setTimeout(done, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      release.resolve();
      await holder;
    }
    expect(await pending).toBe(409);
    const row = await read(setup.project.id);
    expect(row.repository).toBe('fictional/winner');
    expect(row.files.map((file) => file.path)).toEqual(['original.md']);
    expect(row.auditEvents.length).toBe(0);
    expect(row.credentialEncrypted === setup.connection?.credentialEncrypted).toBe(true);
  }, 30_000);

  it('persists exactly the generated missing secret, exposes it once, and keeps an omitted credential', async () => {
    const setup = await fixture(true, true);
    const result = await workflow.connectGitHub(setup.project.id, 'fictional-author', input());
    const row = await read(setup.project.id);
    expect(typeof result.webhookSecret === 'string' && result.webhookSecret.length === 64).toBe(true);
    expect(Boolean(row.webhookSecretEncrypted)).toBe(true);
    expect(crypto.decryptGitSecret(row.webhookSecretEncrypted ?? '') === result.webhookSecret).toBe(true);
    expect(row.credentialEncrypted === setup.connection?.credentialEncrypted).toBe(true);
    const next = await workflow.connectGitHub(setup.project.id, 'fictional-author', input());
    expect(next.webhookSecret).toBeNull();
    expect((await read(setup.project.id)).webhookSecretEncrypted === row.webhookSecretEncrypted).toBe(true);
    const status = await workflow.getGitWorkspaceStatus(setup.project.id);
    expect(JSON.stringify(status).includes(result.webhookSecret ?? 'missing')).toBe(false);
    expect(result.connection).not.toHaveProperty('credentialEncrypted');
    expect(result.connection).not.toHaveProperty('webhookSecretEncrypted');
    expect(result.connection).not.toHaveProperty('saveVersion');
  });

  it('rolls back configuration, replacement credential, generated secret and ledger when target initialization fails', async () => {
    const setup = await fixture(true, true);
    await expect(
      workflow.connectGitHub(setup.project.id, 'fictional-author', {
        ...input(),
        token: replacement,
        importBranchId: 'fictional-missing-branch',
      }),
    ).rejects.toMatchObject({ status: 400 });
    const row = await read(setup.project.id);
    expect(row.repository).toBe('fictional/original');
    expect(row.credentialEncrypted === setup.connection?.credentialEncrypted).toBe(true);
    expect(row.webhookSecretEncrypted).toBeNull();
    expect(row.files.map((file) => file.path)).toEqual(['original.md']);
    expect(row.auditEvents.length).toBe(0);
  });

  it('rolls back a first connection and its secret when initialization fails', async () => {
    const setup = await fixture(false);
    await expect(
      workflow.connectGitHub(setup.project.id, 'fictional-author', {
        ...input(),
        token,
        importLanguageId: 'fictional-missing-language',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db.prisma.gitConnection.count({ where: { projectId: setup.project.id } })).toBe(0);
    expect(await db.prisma.gitAuditEvent.count({ where: { projectId: setup.project.id } })).toBe(0);
  });

  it('preserves normalization and explicit import targets and never affects another project', async () => {
    const setup = await fixture();
    const other = await fixture();
    const before = await read(other.project.id);
    const result = await workflow.connectGitHub(setup.project.id, 'fictional-author', {
      ...input(' https://github.com/fictional/normalized.git '),
      importBranchId: setup.branch.id,
      importLanguageId: setup.language.id,
      token: '',
    });
    expect(result.connection).toMatchObject({
      projectId: setup.project.id,
      repository: 'fictional/normalized',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      contentPath: 'docs',
      importBranchId: setup.branch.id,
      importLanguageId: setup.language.id,
    });
    expect(await read(other.project.id)).toEqual(before);
    expect((await read(setup.project.id)).files[0]).toMatchObject({ branchId: setup.branch.id, languageId: setup.language.id });
  });

  it('carries the real action conflict through admin authorization and HTTP, with no access to another tenant', async () => {
    const setup = await fixture();
    const other = await fixture();
    const name = `fictional-lane794-user-${randomUUID()}`;
    const user = await db.prisma.user.create({ data: { name, email: `${name}@example.invalid` } });
    users.push(user.id);
    await db.prisma.member.create({ data: { userId: user.id, organizationId: setup.project.organizationId, role: 'admin' } });
    const app = routeFor(user);
    const request = (projectId: string, repository: string) =>
      app.request(`/projects/${projectId}/git/connection`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input(repository)),
      });
    const gates = gated();
    const first = request(setup.project.id, 'fictional/first');
    await gates.seen[0]?.promise;
    const second = request(setup.project.id, 'fictional/second');
    await gates.seen[1]?.promise;
    gates.go[0]?.resolve();
    try {
      expect((await first).status).toBe(200);
    } finally {
      gates.go[1]?.resolve();
    }
    const response = await second;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'database:conflict', message: 'The repository connection changed. Refresh and save again.' },
    });
    const before = await read(other.project.id);
    expect((await request(other.project.id, 'fictional/forbidden')).status).toBe(404);
    expect(await read(other.project.id)).toEqual(before);
  });

  it("refuses session A's form loaded before session B's committed save (#876), keeping all of B's state, then saves once A has B's revision", async () => {
    const setup = await fixture();
    const name = `fictional-lane876-user-${randomUUID()}`;
    const user = await db.prisma.user.create({ data: { name, email: `${name}@example.invalid` } });
    users.push(user.id);
    await db.prisma.member.create({ data: { userId: user.id, organizationId: setup.project.organizationId, role: 'admin' } });
    const app = routeFor(user);
    const put = (body: Record<string, unknown>) =>
      app.request(`/projects/${setup.project.id}/git/connection`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    // Both sessions loaded the connection at revision 1.
    expect((await read(setup.project.id)).settingsRevision).toBe(1);
    // B rotates the token and moves the content path; its save commits before A's request starts.
    const fromB = await put({ ...input('fictional/original'), contentPath: 'moved-by-b', token: replacement, expectedRevision: 1 });
    expect(fromB.status).toBe(200);
    const afterB = await read(setup.project.id);
    expect(afterB).toMatchObject({ contentPath: 'moved-by-b', settingsRevision: 2 });
    // A changes only the authoring branch; its form still holds the old path and revision 1.
    const fromA = await put({ ...input('fictional/original'), headBranch: 'nibleaf/from-a', contentPath: 'docs', expectedRevision: 1 });
    expect(fromA.status).toBe(409);
    expect(await fromA.json()).toEqual({
      error: { code: 'database:conflict', message: 'The repository connection changed. Refresh and save again.' },
    });
    // B's settings, credential, secret, ledger and audit are exactly as B left them.
    expect(await read(setup.project.id)).toEqual(afterB);
    expect(crypto.decryptGitSecret(afterB.credentialEncrypted ?? '') === replacement).toBe(true);
    expect(afterB.webhookSecretEncrypted === setup.connection?.webhookSecretEncrypted).toBe(true);
    expect(afterB.auditEvents.map((event) => event.action)).toEqual(['connection.updated']);
    // Once A's form shows B's save, its save goes through on top of it.
    const retried = await put({ ...input('fictional/original'), headBranch: 'nibleaf/from-a', contentPath: 'moved-by-b', expectedRevision: 2 });
    expect(retried.status).toBe(200);
    const body = (await retried.json()) as { data: { connection: Record<string, unknown>; webhookSecret: string | null } };
    expect(body.data.connection).toMatchObject({
      headBranch: 'nibleaf/from-a',
      contentPath: 'moved-by-b',
      settingsRevision: 3,
      credentialConfigured: true,
    });
    expect(body.data.connection).not.toHaveProperty('credentialEncrypted');
    expect(body.data.connection).not.toHaveProperty('webhookSecretEncrypted');
    expect(body.data.webhookSecret).toBeNull();
    const final = await read(setup.project.id);
    expect(crypto.decryptGitSecret(final.credentialEncrypted ?? '') === replacement).toBe(true);
    expect(final.webhookSecretEncrypted === setup.connection?.webhookSecretEncrypted).toBe(true);
    // A sync-status write is not a settings save: it leaves the revision alone.
    await db.prisma.gitConnection.update({ where: { projectId: setup.project.id }, data: { lastSyncStatus: 'RUNNING' } });
    expect((await read(setup.project.id)).settingsRevision).toBe(3);
  });

  it('refuses a form left open from before a disconnect once the site reconnects (#915): the revision carries on', async () => {
    const setup = await fixture();
    const name = `fictional-lane915-user-${randomUUID()}`;
    const user = await db.prisma.user.create({ data: { name, email: `${name}@example.invalid` } });
    users.push(user.id);
    await db.prisma.member.create({ data: { userId: user.id, organizationId: setup.project.organizationId, role: 'admin' } });
    const app = routeFor(user);
    const put = (body: Record<string, unknown>) =>
      app.request(`/projects/${setup.project.id}/git/connection`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const disconnect = () => app.request(`/projects/${setup.project.id}/git/connection`, { method: 'DELETE' });
    const site = () => db.prisma.project.findUniqueOrThrow({ where: { id: setup.project.id } });
    // A form loaded the connection at revision 1; one save moves it to 2, which a second form shows.
    expect((await put({ ...input('fictional/original'), expectedRevision: 1 })).status).toBe(200);
    expect((await read(setup.project.id)).settingsRevision).toBe(2);
    const before = await site();
    expect((await disconnect()).status).toBe(200);
    expect(await db.prisma.gitConnection.count({ where: { projectId: setup.project.id } })).toBe(0);
    // The site keeps the revision the connection reached, and only that: its updatedAt doesn't move.
    expect(await site()).toEqual({ ...before, gitSettingsRevisionFloor: 2 });
    // A form still open from before the disconnect is refused while the site has no connection.
    expect((await put({ ...input('fictional/stale'), token, expectedRevision: 2 })).status).toBe(409);
    // Someone reconnects: the new connection starts past every revision the old one used.
    const reconnected = await put({ ...input('fictional/reconnected'), token: replacement, expectedRevision: null });
    expect(reconnected.status).toBe(200);
    const fresh = await read(setup.project.id);
    expect(fresh).toMatchObject({ repository: 'fictional/reconnected', settingsRevision: 3 });
    // Both forms from before the disconnect are refused, keeping the new connection exactly as it is.
    for (const expectedRevision of [1, 2]) {
      const stale = await put({ ...input('fictional/stale'), headBranch: 'nibleaf/stale', expectedRevision });
      expect(stale.status).toBe(409);
    }
    expect(await read(setup.project.id)).toEqual(fresh);
    expect(crypto.decryptGitSecret(fresh.credentialEncrypted ?? '') === replacement).toBe(true);
    // A form that loaded the new connection saves.
    expect((await put({ ...input('fictional/reconnected'), expectedRevision: 3 })).status).toBe(200);
    expect((await read(setup.project.id)).settingsRevision).toBe(4);
    // A second disconnect and reconnect carries on again.
    expect((await disconnect()).status).toBe(200);
    expect((await site()).gitSettingsRevisionFloor).toBe(4);
    expect((await put({ ...input('fictional/again'), token, expectedRevision: null })).status).toBe(200);
    expect((await read(setup.project.id)).settingsRevision).toBe(5);
    // Disconnecting a site with no connection changes nothing.
    await db.prisma.gitConnection.delete({ where: { projectId: setup.project.id } });
    const unconnected = await site();
    expect((await disconnect()).status).toBe(200);
    expect(await site()).toEqual(unconnected);
  });
});
