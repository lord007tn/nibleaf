import { parseAddonConfigRecord } from '@nibleaf/shared/addons';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const database = vi.hoisted(() => ({
  authorizeProject: vi.fn(),
  findAuditCursor: vi.fn(),
  listAuditEvents: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }) },
  prisma: {
    project: { findFirst: database.authorizeProject, findUnique: vi.fn() },
    projectAddon: { findMany: vi.fn(), findUnique: vi.fn() },
    projectAddonAuditEvent: { findFirst: database.findAuditCursor, findMany: database.listAuditEvents },
    $transaction: database.transaction,
  },
}));

import { activateProjectAddon, deactivateProjectAddon, listProjectAddonAuditEvents, updateProjectAddon } from './addons';

interface AddonRow {
  id: string;
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  revision: number;
  updatedAt: Date;
}

const projectId = 'project-1';
const organizationId = 'org-1';
const userContext = {
  get: (key: string) => {
    if (key === 'user') return { id: 'user-1', name: 'Owner', email: 'owner@example.com' };
    return null;
  },
} as unknown as Context<HonoEnv>;
const legacyWildcardContext = {
  get: (key: string) => (key === 'apiKey' ? { id: 'key-1', projectId, scopes: ['*'] } : null),
} as unknown as Context<HonoEnv>;

const initialRows = (): AddonRow[] => [
  {
    id: 'addon-feedback',
    key: 'feedback',
    enabled: true,
    config: { placement: 'after-content', presentation: 'compact' },
    revision: 1,
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
  },
  {
    id: 'addon-consent',
    key: 'consent-banner',
    enabled: true,
    config: { placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline' },
    revision: 1,
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
  },
];

describe('project add-on mutations', () => {
  let rows: Map<string, AddonRow>;
  let projectConfig: Record<string, unknown>;
  let projectUpdatedAt: Date;
  let auditEvents: unknown[];
  let transactionQueue: Promise<void>;
  let forceRevisionConflict: string | null;
  let forceCreateConflict: string | null;

  beforeEach(() => {
    rows = new Map(initialRows().map((row) => [row.key, row]));
    projectConfig = { search: { mode: 'hybrid' }, theme: { preset: 'signal' }, analytics: { provider: 'plausible' } };
    projectUpdatedAt = new Date('2026-08-23T00:00:00.000Z');
    auditEvents = [];
    transactionQueue = Promise.resolve();
    forceRevisionConflict = null;
    forceCreateConflict = null;

    database.authorizeProject.mockReset();
    database.authorizeProject.mockResolvedValue({
      id: projectId,
      organizationId,
      config: projectConfig,
      organization: { metadata: null, members: [{ role: 'owner' }] },
    });
    database.findAuditCursor.mockReset();
    database.listAuditEvents.mockReset();

    const transactionClient = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: projectId }]),
      projectAddon: {
        findUnique: vi.fn(async ({ where }: { where: { projectId_key: { key: string } } }) => rows.get(where.projectId_key.key) ?? null),
        findMany: vi.fn(async () => [...rows.values()].map((row) => ({ key: row.key, enabled: row.enabled, config: row.config }))),
        updateManyAndReturn: vi.fn(
          async ({ where, data }: { where: { id: string; revision: number }; data: { enabled?: boolean; config?: Record<string, unknown> } }) => {
            const current = [...rows.values()].find((row) => row.id === where.id);
            if (!current || current.revision !== where.revision || forceRevisionConflict === current.key) return [];
            const next = {
              ...current,
              ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
              ...(data.config === undefined ? {} : { config: data.config }),
              revision: current.revision + 1,
              updatedAt: new Date(current.updatedAt.getTime() + 1),
            };
            rows.set(current.key, next);
            return [next];
          },
        ),
        create: vi.fn(async ({ data }: { data: Omit<AddonRow, 'id' | 'updatedAt'> }) => {
          if (forceCreateConflict === data.key || rows.has(data.key)) {
            throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
          }
          const row = { ...data, id: `addon-${data.key}`, updatedAt: new Date('2026-08-23T00:00:00.000Z') };
          rows.set(data.key, row);
          return row;
        }),
      },
      projectAddonAuditEvent: {
        create: vi.fn(async ({ data }: { data: unknown }) => {
          auditEvents.push(data);
          return data;
        }),
      },
      project: {
        findFirst: vi.fn(async () => ({ config: projectConfig, updatedAt: projectUpdatedAt })),
        updateManyAndReturn: vi.fn(async ({ where, data }: { where: { updatedAt: Date }; data: { config: Record<string, unknown> } }) => {
          if (where.updatedAt.getTime() !== projectUpdatedAt.getTime()) return [];
          projectConfig = data.config;
          projectUpdatedAt = new Date(projectUpdatedAt.getTime() + 1);
          return [{ id: projectId, config: projectConfig, updatedAt: projectUpdatedAt }];
        }),
      },
    };

    database.transaction.mockReset();
    database.transaction.mockImplementation((callback: (tx: typeof transactionClient) => Promise<unknown>) => {
      const run = transactionQueue.then(() => callback(transactionClient));
      transactionQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
  });

  it('serializes different add-ons so durable rows and the compatibility projection both survive', async () => {
    await Promise.all([
      deactivateProjectAddon(userContext, projectId, 'feedback', { expectedRevision: 1 }),
      deactivateProjectAddon(userContext, projectId, 'consent-banner', { expectedRevision: 1 }),
    ]);

    expect(rows.get('feedback')).toMatchObject({ enabled: false, revision: 2 });
    expect(rows.get('consent-banner')).toMatchObject({ enabled: false, revision: 2 });
    expect(projectConfig).toMatchObject({
      search: { mode: 'hybrid' },
      theme: { preset: 'signal' },
      addons: { feedback: false, consentBanner: { enabled: false } },
      analytics: { provider: 'plausible', cookieConsent: false },
    });
    expect(auditEvents).toHaveLength(2);
  });

  it('maps a failed revision compare-and-swap to the stable conflict code', async () => {
    forceRevisionConflict = 'feedback';
    await expect(
      updateProjectAddon(userContext, projectId, 'feedback', {
        expectedRevision: 1,
        config: { placement: 'after-navigation', presentation: 'card' },
      }),
    ).rejects.toMatchObject({ code: 'addon:revision_conflict', status: 409 });
    expect(rows.get('feedback')).toMatchObject({ revision: 1, config: { placement: 'after-content' } });
    expect(auditEvents).toHaveLength(0);
  });

  it('keeps a matching activation idempotent without a revision or audit event', async () => {
    const addon = await activateProjectAddon(userContext, projectId, 'feedback', { expectedRevision: 1 });
    expect(addon).toMatchObject({ enabled: true, revision: 1 });
    expect(rows.get('feedback')).toMatchObject({ enabled: true, revision: 1 });
    expect(auditEvents).toHaveLength(0);
  });

  it('does not treat a legacy wildcard API key as an add-on write scope', async () => {
    await expect(deactivateProjectAddon(legacyWildcardContext, projectId, 'feedback', { expectedRevision: 1 })).rejects.toMatchObject({
      code: 'auth:insufficient_role',
      status: 403,
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('keeps an unauthorized project selector opaque across tenants', async () => {
    database.authorizeProject.mockResolvedValueOnce(null);
    await expect(deactivateProjectAddon(userContext, 'other-project', 'feedback', { expectedRevision: 1 })).rejects.toMatchObject({
      code: 'database:not_found',
      status: 404,
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('maps a revision-zero unique create race to the same stable conflict', async () => {
    rows.delete('issue-links');
    forceCreateConflict = 'issue-links';
    await expect(
      updateProjectAddon(userContext, projectId, 'issue-links', {
        expectedRevision: 0,
        config: { urlTemplate: 'https://github.com/acme/docs/issues/new?path={path}' },
      }),
    ).rejects.toMatchObject({ code: 'addon:revision_conflict', status: 409 });
    expect(auditEvents).toHaveLength(0);
  });

  it('keeps empty URL-template add-on projections valid durable JSON', async () => {
    await updateProjectAddon(userContext, projectId, 'edit-suggestions', { expectedRevision: 0, config: {} });
    await updateProjectAddon(userContext, projectId, 'issue-links', { expectedRevision: 0, config: {} });

    const addons = parseAddonConfigRecord(projectConfig.addons);
    expect(addons).not.toHaveProperty('editUrl');
    expect(addons).not.toHaveProperty('issueUrl');
    expect(addons).toMatchObject({ editSuggestions: true, issueLinks: true });
    expect(JSON.parse(JSON.stringify(projectConfig))).toEqual(projectConfig);
    expect(auditEvents).toHaveLength(2);
  });

  it('rejects an audit cursor that belongs to a different filtered add-on', async () => {
    database.findAuditCursor.mockResolvedValue(null);

    await expect(
      listProjectAddonAuditEvents(userContext, projectId, { addonId: 'consent-banner', cursor: 'feedback-event', limit: 30 }),
    ).rejects.toMatchObject({ code: 'database:not_found', status: 404 });
    expect(database.findAuditCursor).toHaveBeenCalledWith({
      where: { id: 'feedback-event', projectId, addonKey: 'consent-banner' },
      select: { id: true },
    });
    expect(database.listAuditEvents).not.toHaveBeenCalled();
  });
});
