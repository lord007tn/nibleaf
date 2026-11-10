import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ eraseAnalytics: vi.fn(), eraseUsage: vi.fn(), eraseAi: vi.fn(), queue: vi.fn() }));
vi.mock('@nibleaf/bullmq', () => ({
  createJob: effects.queue,
  getJob: async () => null,
  removeJob: vi.fn(),
  QueueNames: { ERASURE: 'erasure', SEARCH: 'search' },
}));
vi.mock('@nibleaf/clickhouse', async (original) => ({
  ...(await original<typeof import('@nibleaf/clickhouse')>()),
  deleteProjectAnalytics: effects.eraseAnalytics,
  deleteProjectUsage: effects.eraseUsage,
  deleteProjectAiConversations: effects.eraseAi,
}));

// The relational boundary is real. Queue/ClickHouse calls are captured so this
// suite never contacts another team's services. All rows/schemas are synthetic.
describe.skipIf(process.env.DATA_PARTITION_INTEGRATION !== '1')('website data partitions on PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let erasure: typeof import('@nibleaf/auth/tenant-erasure');
  let account: typeof import('@nibleaf/auth/account-deletion');
  let git: typeof import('./git-webhook-secret');
  let signatures: typeof import('./git-webhook');
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    erasure = await import('@nibleaf/auth/tenant-erasure');
    account = await import('@nibleaf/auth/account-deletion');
    git = await import('./git-webhook-secret');
    signatures = await import('./git-webhook');
  }, 120_000);
  afterAll(async () => {
    if (!db) return;
    await db.prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
  });

  const org = async () => {
    const id = `partition-${randomUUID()}`;
    const row = await db.prisma.organization.create({ data: { name: id, slug: id } });
    orgIds.push(row.id);
    return row;
  };
  const site = async (organizationId: string) => {
    const id = `site-${randomUUID()}`;
    return db.prisma.project.create({
      data: {
        organizationId,
        name: id,
        slug: id,
        gitSettings: { create: { settings: { repo: id } } },
        gitWebhookSecret: { create: { secret: `secret-${id}` } },
        legacySettings: { create: { metadata: { integrations: { website: id }, unclassified: id } } },
      },
    });
  };
  const seedUsage = async (project: { id: string; dataTenantId: string }) => {
    const event = {
      eventId: randomUUID(),
      schemaVersion: 1 as const,
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      tenantId: project.dataTenantId,
      projectId: project.id,
      meterKey: 'search_query' as const,
      quantity: '1',
      kind: 'usage' as const,
      correctionOfEventId: null,
      source: 'worker' as const,
    };
    const id = randomUUID();
    await db.markUsageStoragePending({ id, partitionId: project.dataTenantId, projectId: project.id, events: [event] });
    await db.markUsageStorageDrained(id, project.dataTenantId);
    return id;
  };

  it('rehearses the expand migration over old rows without changing legacy values', async () => {
    const requireDb = createRequire(import.meta.resolve('@nibleaf/database'));
    const requireAdapter = createRequire(requireDb.resolve('@prisma/adapter-pg'));
    interface Client {
      connect(): Promise<void>;
      end(): Promise<void>;
      query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    }
    const { Client: PgClient } = requireAdapter('pg') as { Client: new (config: { connectionString: string }) => Client };
    const client = new PgClient({ connectionString: process.env.POSTGRES_URL ?? '' });
    const schema = `partition_rehearsal_${randomUUID().replaceAll('-', '')}`;
    const migrations = fileURLToPath(new URL('../../../../packages/database/prisma/migrations/', import.meta.url));
    const migration = '20261110130000_website_data_partition';
    const metadata = {
      plan: 'pro',
      notifications: { a: false },
      entitlements: {},
      git: { repo: 'old/repo', webhookSecret: 'fallback-exact-secret', lastSyncAt: 'unchanged' },
      integrations: { token: 'fictional' },
      unknown: { keep: ['exact', 2] },
    };
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}", public`);
      for (const entry of readdirSync(migrations)
        .filter((name) => name < migration)
        .sort()) {
        if (!/^\d/u.test(entry)) continue;
        await client.query(readFileSync(`${migrations}/${entry}/migration.sql`, 'utf8'));
      }
      await client.query(`INSERT INTO organization (id,name,slug,metadata) VALUES ('old-org','Old','old-org',$1)`, [JSON.stringify(metadata)]);
      await client.query(`INSERT INTO project (id,"organizationId",name,slug,"updatedAt") VALUES ('old-site','old-org','Old','old-site',now())`);
      await client.query(
        `INSERT INTO organization_git_webhook_secret ("organizationId",secret,"updatedAt") VALUES ('old-org','stored-exact-secret',now())`,
      );
      await client.query(`INSERT INTO usage_storage_marker ("organizationId") VALUES ('old-org')`);
      await client.query(
        `INSERT INTO usage_ingest_checkpoint (id,"organizationId","projectId","firstOccurredAt","lastOccurredAt",events,"payloadDigest","updatedAt") VALUES ('receipt','old-org','old-site',now(),now(),'[]','digest',now())`,
      );
      await client.query(readFileSync(`${migrations}/${migration}/migration.sql`, 'utf8'));
      const one = async (sql: string) => (await client.query(sql)).rows[0];
      expect(await one(`SELECT "dataTenantId" FROM project WHERE id='old-site'`)).toEqual({ dataTenantId: 'old-org' });
      expect(await one(`SELECT settings FROM project_git_settings WHERE "projectId"='old-site'`)).toEqual({
        settings: { repo: 'old/repo', lastSyncAt: 'unchanged' },
      });
      expect(await one(`SELECT secret FROM project_git_webhook_secret WHERE "projectId"='old-site'`)).toEqual({ secret: 'stored-exact-secret' });
      expect(await one(`SELECT metadata FROM project_legacy_settings WHERE "projectId"='old-site'`)).toEqual({
        metadata: { integrations: metadata.integrations, unknown: metadata.unknown },
      });
      expect(await one(`SELECT metadata FROM organization WHERE id='old-org'`)).toEqual({ metadata: JSON.stringify(metadata) });
      expect(await one(`SELECT "partitionId","projectId","organizationId" FROM usage_storage_marker`)).toEqual({
        partitionId: 'old-org',
        projectId: 'old-site',
        organizationId: 'old-org',
      });
      expect(await one(`SELECT "partitionId","projectId","organizationId" FROM usage_ingest_checkpoint`)).toEqual({
        partitionId: 'old-org',
        projectId: 'old-site',
        organizationId: 'old-org',
      });
      await expect(client.query(`UPDATE project SET "dataTenantId"='changed' WHERE id='old-site'`)).rejects.toThrow('immutable');
      // An old image can still insert without the new columns.
      await client.query(`INSERT INTO organization(id,name,slug) VALUES ('old-insert','Old image','old-insert')`);
      await client.query(
        `INSERT INTO project(id,"organizationId",name,slug,"updatedAt") VALUES ('old-insert-site','old-insert','Old image','old-insert-site',now())`,
      );
      await client.query(`INSERT INTO usage_storage_marker("organizationId") VALUES ('old-insert')`);
      expect(await one(`SELECT "partitionId","projectId" FROM usage_storage_marker WHERE "organizationId"='old-insert'`)).toEqual({
        partitionId: 'old-insert',
        projectId: 'old-insert-site',
      });
    } finally {
      await client.query('ROLLBACK');
      await client.query(`SET search_path TO public; DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  }, 120_000);

  it('rejects partition mutation and keeps receipts/settings/signatures after an org move and source deletion', async () => {
    const source = await org();
    const destination = await org();
    const project = await site(source.id);
    const receipt = await seedUsage(project);
    const before = await db.prisma.projectGitSettings.findUnique({ where: { projectId: project.id } });
    const secret = await git.getGitWebhookSecret(project.id);
    await expect(db.prisma.project.update({ where: { id: project.id }, data: { dataTenantId: 'changed' } })).rejects.toThrow();
    await db.prisma.project.update({ where: { id: project.id }, data: { organizationId: destination.id } });
    await db.prisma.organization.delete({ where: { id: source.id } });
    expect(await db.prisma.usageIngestCheckpoint.findUnique({ where: { id: receipt } })).toMatchObject({
      partitionId: project.dataTenantId,
      projectId: project.id,
    });
    expect(await db.prisma.usageStorageMarker.findUnique({ where: { partitionId: project.dataTenantId } })).toMatchObject({ projectId: project.id });
    expect(await db.prisma.projectGitSettings.findUnique({ where: { projectId: project.id } })).toEqual(before);
    const body = '{"ref":"refs/heads/main"}';
    const signature = `sha256=${createHmac('sha256', secret ?? '')
      .update(body)
      .digest('hex')}`;
    expect(signatures.verifyGitHubSignature(body, signature, (await git.getGitWebhookSecret(project.id)) ?? '')).toBe(true);
  });

  it('dual-writes website settings and returns only that website configuration', async () => {
    const workspace = await import('./workspace');
    const organization = await org();
    const a = await site(organization.id);
    const b = await site(organization.id);
    const beforeSibling = await db.prisma.projectGitSettings.findUnique({ where: { projectId: b.id } });
    const secret = await git.getGitWebhookSecret(a.id);
    await workspace.updateWorkspaceSettings(
      organization.id,
      'website-settings-only-actor',
      { git: { provider: 'github', repo: 'synthetic/updated' }, integrations: { website: a.id } },
      a.id,
    );
    expect(await db.prisma.projectGitSettings.findUnique({ where: { projectId: a.id } })).toMatchObject({ settings: { repo: 'synthetic/updated' } });
    expect(await db.prisma.projectGitSettings.findUnique({ where: { projectId: b.id } })).toEqual(beforeSibling);
    expect(await git.getGitWebhookSecret(a.id)).toBe(secret);
    const mirror = JSON.parse((await db.prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).metadata ?? '{}');
    expect(mirror.git.repo).toBe('synthetic/updated');
    expect(mirror.integrations).toEqual({ website: a.id });
    const dto = await workspace.getScopedWorkspaceSettings(organization.id, 'admin', a.id);
    expect(dto.git.repo).toBe('synthetic/updated');
    expect(dto).not.toHaveProperty('unclassified');
    expect(dto.integrations).toEqual({ website: a.id });
    expect((await workspace.getScopedWorkspaceSettings(organization.id, 'viewer', b.id)).git.repo).toBe(b.slug);
  });

  it('records provider source partition and billing owner without changing accepted receipts', async () => {
    const source = await org();
    const destination = await org();
    const project = await site(source.id);
    await db.prisma.project.update({ where: { id: project.id }, data: { organizationId: destination.id } });
    const record = {
      tenantId: project.dataTenantId,
      projectId: project.id,
      meterKey: 'search_query' as const,
      periodStart: '2026-10-01T00:00:00Z',
      periodEndExclusive: '2026-11-01T00:00:00Z',
      quantity: '7',
      reconciliationId: randomUUID(),
    };
    try {
      const checkpoint = await db.markUsageProviderAttempt('synthetic', record);
      expect(checkpoint).toMatchObject({ organizationId: project.dataTenantId, projectId: project.id, billingOrganizationId: destination.id });
      await db.prisma.usageProviderCheckpoint.update({ where: { id: checkpoint.id }, data: { status: 'accepted', acceptedAt: new Date() } });
      await db.prisma.project.update({ where: { id: project.id }, data: { organizationId: source.id } });
      expect(await db.markUsageProviderAttempt('synthetic', record)).toMatchObject({
        status: 'accepted',
        billingOrganizationId: destination.id,
        organizationId: project.dataTenantId,
      });
    } finally {
      await db.prisma.usageProviderCheckpoint.deleteMany({ where: { reconciliationId: record.reconciliationId } });
    }
  });

  it('erases one website without touching its sibling partition, fence, settings or secret', async () => {
    const organization = await org();
    const first = await site(organization.id);
    const sibling = await site(organization.id);
    await seedUsage(first);
    await seedUsage(sibling);
    const marker = await db.prisma.usageStorageMarker.findUnique({ where: { partitionId: sibling.dataTenantId } });
    const settings = await db.prisma.projectGitSettings.findUnique({ where: { projectId: sibling.id } });
    const secret = await git.getGitWebhookSecret(sibling.id);
    effects.eraseUsage.mockClear();
    await erasure.eraseProject(first.id);
    expect(effects.eraseUsage).toHaveBeenCalledExactlyOnceWith(first.dataTenantId, first.id);
    expect(await db.prisma.project.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await db.prisma.organization.findUnique({ where: { id: organization.id } })).not.toBeNull();
    expect(await db.prisma.usageStorageMarker.findUnique({ where: { partitionId: sibling.dataTenantId } })).toEqual(marker);
    expect(await db.prisma.projectGitSettings.findUnique({ where: { projectId: sibling.id } })).toEqual(settings);
    expect(await git.getGitWebhookSecret(sibling.id)).toBe(secret);
    expect(await db.markAnalyticsStoragePending(sibling.dataTenantId, sibling.id)).toEqual({ accepted: true });
  });

  it('erases every website before its organization', async () => {
    const organization = await org();
    const a = await site(organization.id);
    const b = await site(organization.id);
    await seedUsage(a);
    await seedUsage(b);
    effects.eraseUsage.mockClear();
    await erasure.eraseOrganization(organization.id);
    expect(effects.eraseUsage).toHaveBeenCalledWith(a.dataTenantId, a.id);
    expect(effects.eraseUsage).toHaveBeenCalledWith(b.dataTenantId, b.id);
    expect(await db.prisma.organization.findUnique({ where: { id: organization.id } })).toBeNull();
    expect(await db.prisma.usageStorageMarker.count({ where: { projectId: { in: [a.id, b.id] } } })).toBe(0);
  });

  it('refuses account deletion while owning any organization, including empty ones', async () => {
    const user = await db.prisma.user.create({ data: { name: 'Synthetic owner', email: `partition-${randomUUID()}@nibleaf.test` } });
    userIds.push(user.id);
    const empty = await org();
    const populated = await org();
    for (const organizationId of [empty.id, populated.id])
      await db.prisma.member.create({ data: { userId: user.id, organizationId, role: 'owner', orgRole: 'owner' } });
    const project = await site(populated.id);
    await expect(account.reassignOrDeleteOrgs(user.id)).rejects.toThrow('Transfer ownership or delete your organization first');
    expect(await db.prisma.organization.findUnique({ where: { id: empty.id } })).not.toBeNull();
    await db.prisma.project.delete({ where: { id: project.id } });
    const other = await db.prisma.user.create({ data: { name: 'Synthetic member', email: `partition-${randomUUID()}@nibleaf.test` } });
    userIds.push(other.id);
    const member = await db.prisma.member.create({ data: { organizationId: populated.id, userId: other.id, role: 'viewer' } });
    await expect(account.reassignOrDeleteOrgs(user.id)).rejects.toThrow('Transfer ownership or delete your organization first');
    await db.prisma.member.delete({ where: { id: member.id } });
    await expect(account.reassignOrDeleteOrgs(user.id)).rejects.toThrow('Transfer ownership or delete your organization first');
    expect(await db.prisma.organization.count({ where: { id: { in: [empty.id, populated.id] } } })).toBe(2);
  });
});
