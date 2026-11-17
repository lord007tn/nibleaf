import { addonDefinitions } from '@nibleaf/shared/addons';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #615: an admin invite must land on a free address, or fail cleanly.
 * Mock-only evidence: a stateful in-memory database stands in for PostgreSQL.
 * It enforces the three global unique addresses the invite writes —
 * `project.slug`, `organization.slug` and `organization_handle.slug` — and
 * rolls a failed transaction back. `admin.postgres.test.ts` repeats the
 * address cases against the real database.
 */
const mocks = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };
  type Tables = {
    organization: Row[];
    organizationHandle: Row[];
    project: Row[];
    plan: Row[];
    projectAddon: Row[];
    addonAudit: Row[];
    language: Row[];
    branch: Row[];
    invitation: Row[];
  };
  const empty = (): Tables => ({
    organization: [],
    organizationHandle: [],
    project: [],
    plan: [],
    projectAddon: [],
    addonAudit: [],
    language: [],
    branch: [],
    invitation: [],
  });
  const state = {
    db: empty(),
    nextId: 0,
    transactions: 0,
    organizationCreates: 0,
    KnownRequestError: undefined as unknown as typeof import('@nibleaf/database').Prisma.PrismaClientKnownRequestError,
  };
  const hooks: { beforeProjectCreate?: (slug: string) => void; beforeLanguageCreate?: () => void } = {};
  const id = (prefix: string) => `${prefix}-${String(++state.nextId).padStart(4, '0')}`;
  const uniqueViolation = (target: string) => {
    const [model, field] = target.split('.');
    return new state.KnownRequestError(`Unique constraint failed on ${target}`, {
      code: 'P2002',
      clientVersion: 'fixture',
      meta: { modelName: model === 'organizationHandle' ? 'Organization' : `${model?.[0]?.toUpperCase()}${model?.slice(1)}`, target: [field] },
    });
  };
  const clone = (db: Tables): Tables => Object.fromEntries(Object.entries(db).map(([key, rows]) => [key, rows.map((row) => ({ ...row }))])) as Tables;
  const assertFree = (db: Tables, table: 'organization' | 'organizationHandle' | 'project', slug: string) => {
    if (db[table].some((row) => row.slug === slug)) throw uniqueViolation(`${table}.slug`);
  };
  // Another request committing first, outside any transaction in progress.
  const commitElsewhere = (slug: string) => {
    const organizationId = id('other-org');
    state.db.organization.push({ id: organizationId, slug: `other-${organizationId}` });
    state.db.project.push({ id: id('other-project'), organizationId, slug });
  };
  const readers = (table: 'organization' | 'organizationHandle' | 'project') => ({
    findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => state.db[table].find((row) => row.slug === where.slug) ?? null),
  });
  const txClient = (db: Tables) => ({
    organization: {
      create: vi.fn(async ({ data }: { data: { name: string; slug: string; handles: { create: { slug: string; current: boolean } } } }) => {
        state.organizationCreates++;
        assertFree(db, 'organization', data.slug);
        assertFree(db, 'organizationHandle', data.handles.create.slug);
        const organization = { id: id('org'), name: data.name, slug: data.slug };
        db.organization.push(organization);
        db.organizationHandle.push({ id: data.handles.create.slug, organizationId: organization.id, ...data.handles.create });
        return organization;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        db.organization = db.organization.filter((row) => row.id !== where.id);
        db.organizationHandle = db.organizationHandle.filter((row) => row.organizationId !== where.id);
        db.plan = db.plan.filter((row) => row.organizationId !== where.id);
        db.invitation = db.invitation.filter((row) => row.organizationId !== where.id);
      }),
    },
    project: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> & { slug: string } }) => {
        hooks.beforeProjectCreate?.(data.slug);
        assertFree(db, 'project', data.slug);
        const project = { id: id('project'), dataTenantId: id('tenant'), ...data };
        db.project.push(project);
        return project;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        db.project = db.project.filter((row) => row.id !== where.id);
        for (const table of ['projectAddon', 'addonAudit', 'language', 'branch'] as const)
          db[table] = db[table].filter((row) => row.projectId !== where.id);
      }),
    },
    projectAddon: {
      createMany: vi.fn(
        async ({ data }: { data: Array<Record<string, unknown>> }) => void db.projectAddon.push(...data.map((row) => ({ id: id('addon'), ...row }))),
      ),
    },
    projectAddonAuditEvent: {
      createMany: vi.fn(
        async ({ data }: { data: Array<Record<string, unknown>> }) => void db.addonAudit.push(...data.map((row) => ({ id: id('audit'), ...row }))),
      ),
    },
    language: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        hooks.beforeLanguageCreate?.();
        const language = { id: id('language'), ...data };
        db.language.push(language);
        return language;
      }),
    },
    usagePlan: { assign: (organizationId: string) => void db.plan.push({ id: id('plan'), organizationId }) },
    branch: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const branch = { id: id('branch'), ...data };
        db.branch.push(branch);
        return { id: branch.id };
      }),
    },
  });
  const prisma = {
    organization: readers('organization'),
    organizationHandle: readers('organizationHandle'),
    project: readers('project'),
    // Serializable enough for the race under test: the work runs on a copy and
    // commits only after re-checking the unique addresses against what other
    // transactions committed meanwhile, as PostgreSQL's unique index would.
    $transaction: vi.fn(async (callback: (tx: ReturnType<typeof txClient>) => unknown) => {
      state.transactions++;
      const before = clone(state.db);
      const work = clone(state.db);
      await Promise.resolve();
      const result = await callback(txClient(work));
      for (const table of ['organization', 'organizationHandle', 'project'] as const) {
        const added = work[table].filter((row) => !before[table].some((old) => old.id === row.id));
        for (const row of added) assertFree(state.db, table, row.slug as string);
      }
      const removed = (table: keyof Tables) => before[table].filter((row) => !work[table].some((kept) => kept.id === row.id)).map((row) => row.id);
      for (const table of Object.keys(work) as Array<keyof Tables>) {
        const gone = new Set(removed(table));
        const added = work[table].filter((row) => !before[table].some((old) => old.id === row.id));
        state.db[table] = [...state.db[table].filter((row) => !gone.has(row.id)), ...added];
      }
      return result;
    }),
  };
  return {
    state,
    hooks,
    empty,
    commitElsewhere,
    uniqueViolation,
    prisma,
    randomBytes: vi.fn(),
    realRandomBytes: undefined as unknown,
    assignDefaultUsagePlan: vi.fn(),
    inviteMember: vi.fn(),
    invalidateOrganizationPublishedConfig: vi.fn(async () => undefined),
  };
});

vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof import('node:crypto')>();
  mocks.realRandomBytes = actual.randomBytes;
  return { ...actual, randomBytes: mocks.randomBytes };
});
vi.mock('@nibleaf/database', async (original) => {
  const { Prisma } = await original<typeof import('@nibleaf/database')>();
  mocks.state.KnownRequestError = Prisma.PrismaClientKnownRequestError;
  return { Prisma, prisma: mocks.prisma, assignDefaultUsagePlan: mocks.assignDefaultUsagePlan };
});
vi.mock('@/env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('./members', () => ({ inviteMember: mocks.inviteMember }));
vi.mock('./sites', () => ({ invalidateOrganizationPublishedConfig: mocks.invalidateOrganizationPublishedConfig }));
vi.mock('./usage', () => ({ getProjectUsage: vi.fn() }));
vi.mock('./workspace', () => ({ parseWorkspaceMetadata: () => ({ plan: 'free' }) }));

import { inviteOrganizationOwner } from './admin';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const invite = (overrides: Partial<Parameters<typeof inviteOrganizationOwner>[1]> = {}) =>
  inviteOrganizationOwner(ADMIN, {
    organizationName: ' Acme Org ',
    siteName: ' Acme ',
    ownerEmail: ' Owner@Example.TEST ',
    delivery: 'link',
    ...overrides,
  });
const seedProject = (slug: string) => {
  const organizationId = `seed-org-${slug}`;
  mocks.state.db.organization.push({ id: organizationId, slug: `seed-${slug}` });
  mocks.state.db.project.push({ id: `seed-project-${slug}`, organizationId, slug, name: `Existing ${slug}` });
};
const db = () => mocks.state.db;
const created = () => db().project.filter((row) => !String(row.id).startsWith('seed-') && !String(row.id).startsWith('other-'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.db = mocks.empty();
  mocks.state.nextId = 0;
  mocks.state.transactions = 0;
  mocks.state.organizationCreates = 0;
  mocks.hooks.beforeProjectCreate = undefined;
  mocks.hooks.beforeLanguageCreate = undefined;
  mocks.randomBytes.mockImplementation(mocks.realRandomBytes as (size: number) => Buffer);
  // The plan row is written through the transaction, so it rolls back with it.
  mocks.assignDefaultUsagePlan.mockImplementation(async (tx: { usagePlan: { assign: (id: string) => void } }, organizationId: string) =>
    tx.usagePlan.assign(organizationId),
  );
  mocks.inviteMember.mockImplementation(async (organizationId: string, inviterId: string, _role: string, body: { email: string }) => {
    const invitation = { id: `invitation-${organizationId}`, organizationId, inviterId, email: body.email, kind: 'bootstrap_owner' };
    mocks.state.db.invitation.push(invitation);
    return invitation;
  });
});
afterEach(() => vi.useRealTimers());

describe('admin invite address allocation (#615)', () => {
  it('skips an address whose organization handle is taken, though no site uses it', async () => {
    db().organization.push({ id: 'seed-org-handle', slug: 'seed-handle' });
    db().organizationHandle.push({ id: 'org-acme', slug: 'org-acme', organizationId: 'seed-org-handle', current: false });

    await expect(invite()).resolves.toMatchObject({ slug: 'acme-2' });
    expect(db().organization.find((row) => row.slug === 'org-acme-2')).toBeDefined();
    expect(mocks.state.organizationCreates).toBe(1);
  });

  it('skips an address whose organization slug is taken', async () => {
    db().organization.push({ id: 'seed-org-slug', slug: 'org-acme' });

    await expect(invite()).resolves.toMatchObject({ slug: 'acme-2' });
  });

  it('checks the random fallback when all 100 numbered addresses and the timestamp one are taken', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T00:00:00Z'));
    for (let index = 0; index < 100; index++) seedProject(index === 0 ? 'acme' : `acme-${index + 1}`);
    seedProject(`acme-${Date.now().toString(36)}`);
    const existing = db().project.length;

    const result = await invite();

    expect(result.slug).toMatch(/^acme-[0-9a-f]{8}$/);
    expect(db().project).toHaveLength(existing + 1);
    expect(mocks.state.organizationCreates).toBe(1);
  });

  it('refuses cleanly, before writing, when every candidate address is taken', async () => {
    mocks.randomBytes.mockImplementation(() => Buffer.from([0, 0, 0, 0]));
    for (let index = 0; index < 100; index++) seedProject(index === 0 ? 'acme' : `acme-${index + 1}`);
    seedProject('acme-00000000');
    const before = JSON.stringify(db());

    await expect(invite()).rejects.toMatchObject({ code: 'database:conflict', details: { reason: 'slug_taken' } });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.inviteMember).not.toHaveBeenCalled();
    expect(JSON.stringify(db())).toBe(before);
    expect(mocks.randomBytes).toHaveBeenCalledTimes(4);
  });

  it('checks each random candidate before falling through to another one', async () => {
    for (let index = 0; index < 100; index++) seedProject(index === 0 ? 'acme' : `acme-${index + 1}`);
    seedProject('acme-00000000');
    mocks.randomBytes.mockReturnValueOnce(Buffer.from([0, 0, 0, 0])).mockReturnValueOnce(Buffer.from([0, 0, 0, 1]));
    await expect(invite()).resolves.toMatchObject({ slug: 'acme-00000001' });
    expect(mocks.randomBytes).toHaveBeenCalledTimes(2);
  });

  it('retries the whole rolled-back creation on a new address after the address is taken mid-flight', async () => {
    seedProject('acme-3');
    mocks.hooks.beforeProjectCreate = (slug) => {
      mocks.hooks.beforeProjectCreate = undefined;
      mocks.commitElsewhere(slug);
    };

    const result = await invite({ delivery: 'email' });

    expect(result.slug).toBe('acme-2');
    expect(mocks.state.organizationCreates).toBe(2);
    // The first attempt's organization, handle and plan were rolled back.
    expect(db().organization.filter((row) => String(row.slug).startsWith('org-acme'))).toEqual([expect.objectContaining({ slug: 'org-acme-2' })]);
    expect(db().organizationHandle.map((row) => row.slug)).toEqual(['org-acme-2']);
    expect(db().plan).toEqual([expect.objectContaining({ organizationId: result.organizationId })]);
    expect(created()).toHaveLength(1);
    expect(db().projectAddon.every((row) => row.projectId === result.projectId)).toBe(true);
    expect(db().invitation).toHaveLength(1);
    expect(mocks.inviteMember).toHaveBeenCalledTimes(1);
    expect(mocks.inviteMember).toHaveBeenCalledWith(result.organizationId, ADMIN, 'owner', expect.any(Object), {
      sendEmail: true,
      bootstrapOwner: true,
    });
  });

  it('gives two concurrent invites for one name two addresses', async () => {
    const [first, second] = await Promise.all([invite(), invite({ ownerEmail: 'second@example.test' })]);

    expect(new Set([first.slug, second.slug])).toEqual(new Set(['acme', 'acme-2']));
    expect(created()).toHaveLength(2);
    expect(db().organization).toHaveLength(2);
    expect(db().invitation).toHaveLength(2);
    expect(mocks.inviteMember).toHaveBeenCalledTimes(2);
  });

  it('stops after a bounded number of lost addresses, leaving nothing behind', async () => {
    seedProject('kept');
    mocks.hooks.beforeProjectCreate = (slug) => mocks.commitElsewhere(slug);

    await expect(invite()).rejects.toMatchObject({ code: 'database:conflict', details: { reason: 'slug_taken' } });
    expect(mocks.state.transactions).toBe(4);
    expect(created()).toHaveLength(0);
    expect(db().organization.filter((row) => String(row.slug).startsWith('org-'))).toHaveLength(0);
    expect(db().organizationHandle).toHaveLength(0);
    expect(db().plan).toHaveLength(0);
    expect(mocks.inviteMember).not.toHaveBeenCalled();
    expect(db().project.find((row) => row.slug === 'kept')).toMatchObject({ name: 'Existing kept' });
  });

  it('does not retry a unique violation on anything other than the address', async () => {
    const violation = mocks.uniqueViolation('language.projectId_code');
    mocks.hooks.beforeLanguageCreate = () => {
      throw violation;
    };

    await expect(invite()).rejects.toBe(violation);
    expect(mocks.state.transactions).toBe(1);
    expect(db().organization).toHaveLength(0);
    expect(db().project).toHaveLength(0);
    expect(mocks.inviteMember).not.toHaveBeenCalled();
  });

  it('does not retry any other error', async () => {
    mocks.assignDefaultUsagePlan.mockRejectedValueOnce(new Error('plan catalogue unavailable'));

    await expect(invite()).rejects.toThrow('plan catalogue unavailable');
    expect(mocks.state.transactions).toBe(1);
    expect(db().organization).toHaveLength(0);
  });

  it.each([
    { code: 'P2002', meta: { modelName: 'Language', target: ['slug'] } },
    { code: 'P2002', meta: { modelName: 'Project', target: ['slug', 'organizationId'] } },
    { code: 'P2002', meta: { modelName: 'Project', target: ['dataTenantId'] } },
    { code: 'P2002', meta: { modelName: 'Project', target: 'some_slug_constraint' } },
    { code: 'P2002' },
    { code: 'P2028', meta: { modelName: 'Project', target: ['slug'] } },
  ])('propagates unverified or unrelated constraint metadata: %j', async (failure) => {
    const violation = new mocks.state.KnownRequestError('Synthetic unrelated constraint', { ...failure, clientVersion: 'fixture' });
    mocks.hooks.beforeLanguageCreate = () => {
      throw violation;
    };
    await expect(invite()).rejects.toBe(violation);
    expect(mocks.state.transactions).toBe(1);
    expect(created()).toHaveLength(0);
    expect(mocks.inviteMember).not.toHaveBeenCalled();
  });

  it.each([new Error('delivery failed'), mocks.uniqueViolation('project.slug')])(
    'never recreates the site after the invitation step fails post-commit: %s',
    async (failure) => {
      mocks.inviteMember.mockRejectedValueOnce(failure);

      await expect(invite({ delivery: 'email' })).rejects.toBe(failure);
      expect(mocks.state.organizationCreates).toBe(1);
      expect(mocks.inviteMember).toHaveBeenCalledTimes(1);
      // The compensating delete removes the one site and organization it made.
      expect(db().project).toHaveLength(0);
      expect(db().organization).toHaveLength(0);
      expect(db().invitation).toHaveLength(0);
    },
  );

  it('keeps the default plan, add-ons, owner invitation and omitted defaults', async () => {
    const result = await invite();

    expect(result).toEqual({
      organizationId: expect.any(String),
      projectId: expect.any(String),
      invitationId: `invitation-${result.organizationId}`,
      ownerEmail: 'owner@example.test',
      slug: 'acme',
      invitationUrl: `https://nibleaf.test/accept-invite/invitation-${result.organizationId}`,
      delivery: 'link',
    });
    const [project] = created();
    expect(project).toMatchObject({ organizationId: result.organizationId, name: 'Acme', slug: 'acme' });
    expect(project).not.toHaveProperty('description');
    expect(project?.dataTenantId).not.toBe(result.organizationId);
    expect(db().organization).toEqual([{ id: result.organizationId, name: 'Acme Org', slug: 'org-acme' }]);
    expect(db().organizationHandle).toEqual([expect.objectContaining({ slug: 'org-acme', current: true, organizationId: result.organizationId })]);
    expect(db().plan).toEqual([expect.objectContaining({ organizationId: result.organizationId })]);
    expect(db().projectAddon).toHaveLength(addonDefinitions.length);
    expect(db().addonAudit).toHaveLength(addonDefinitions.length);
    expect(db().addonAudit.every((row) => row.actorUserId === ADMIN)).toBe(true);
    expect(db().language).toEqual([expect.objectContaining({ projectId: result.projectId, code: 'en', isDefault: true })]);
    expect(db().branch).toEqual([expect.objectContaining({ projectId: result.projectId, name: 'main', isDefault: true })]);
    expect(mocks.inviteMember).toHaveBeenCalledWith(
      result.organizationId,
      ADMIN,
      'owner',
      { email: 'owner@example.test', role: 'owner' },
      { sendEmail: false, bootstrapOwner: true },
    );
    expect(mocks.invalidateOrganizationPublishedConfig).toHaveBeenCalledWith(result.organizationId);
  });
});
