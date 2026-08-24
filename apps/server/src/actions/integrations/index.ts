import { keys as clickHouseKeys } from '@nibleaf/clickhouse/keys';
import { type IntegrationWebhookDelivery, Prisma, type ProjectIntegration, prisma } from '@nibleaf/database';
import { keys as qdrantKeys } from '@nibleaf/qdrant/keys';
import { keys as searchKeys } from '@nibleaf/search/keys';
import { MemberRole } from '@nibleaf/shared/constants';
import {
  getIntegrationManifest,
  INTEGRATION_CATALOG,
  type IntegrationCatalogEntry,
  type IntegrationConnectionSummary,
  type IntegrationProviderId,
  type IntegrationPublicConfig,
} from '@nibleaf/shared/integrations';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import { keys as storageKeys } from '@nibleaf/storage/keys';
import {
  type CreateIntegrationDeleteConfirmationBody,
  type CreateProjectIntegrationBody,
  configurableIntegrationProviderIdSchema,
  type DeleteProjectIntegrationBody,
  gitConfigSchema,
  type IntegrationRevisionBody,
  integrationConnectionSummarySchema,
  projectConfigSchema,
  type UpdateProjectIntegrationBody,
  type VerifyProjectIntegrationBody,
} from '@nibleaf/validators';
import type { Context } from 'hono';
import { z } from 'zod';
import { env } from '@/env';
import { AppError, type ErrorCode, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { decryptGitSecret } from '../git/crypto';
import { GitHubProvider } from '../git/github';
import { assertProjectAccess } from '../projects';
import { parseWorkspaceMetadata } from '../workspace';
import {
  decryptIntegrationSecret,
  digestIntegrationValue,
  digestIntegrationValueCandidates,
  encryptIntegrationSecret,
  newIntegrationConfirmationToken,
} from './crypto';
import { verifyWebhookProvider } from './providers';

type IntegrationScope = 'integrations:read' | 'integrations:write' | 'integrations:verify' | 'integrations:delete';
type WebhookProviderId = 'slack' | 'discord' | 'zapier';

const VERIFICATION_RUNNING_LEASE_MS = 60_000;

interface IntegrationAccess {
  organizationId: string;
  principalId: string;
  principalType: 'api_key' | 'session';
}

const webhookConfigSchema = z.object({ label: z.string().nullable() }).strict();
const legacyGitMetadataSchema = z.record(z.string(), z.unknown());
const verificationCodeSchema = z.enum([
  'integration:credentials_invalid',
  'integration:provider_unavailable',
  'integration:revision_conflict',
  'integration:verification_failed',
]);
const safeVerificationCode = (value: string | null) => {
  const parsed = verificationCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const integrationError = (code: Extract<ErrorCode, `integration:${string}`>, message: string) => new AppError({ code, message });

const replayVerificationDelivery = (delivery: IntegrationWebhookDelivery) => {
  if (delivery.status === 'SUCCEEDED') return integrationConnectionSummarySchema.parse(delivery.result);
  if (delivery.status !== 'FAILED') return null;
  const code = safeVerificationCode(delivery.errorCode) ?? 'integration:provider_unavailable';
  throw integrationError(code, 'The provider could not verify this connection.');
};

const staleRunningDeliveryWhere = (delivery: IntegrationWebhookDelivery, staleBefore: Date) => ({
  id: delivery.id,
  status: 'RUNNING',
  OR: [{ startedAt: { lte: staleBefore } }, { startedAt: null, createdAt: { lte: staleBefore } }],
});

const canonicalCreateRequest = (body: CreateProjectIntegrationBody) =>
  JSON.stringify(['integration-request', 1, 'create', body.providerId, body.webhookUrl, body.label ?? null]);

const canonicalUpdateRequest = (providerId: WebhookProviderId, body: UpdateProjectIntegrationBody) =>
  JSON.stringify([
    'integration-request',
    1,
    'update',
    providerId,
    body.expectedRevision,
    body.label === undefined ? ['absent'] : ['value', body.label],
    body.webhookUrl === undefined ? ['absent'] : ['replace', body.webhookUrl],
    body.replaceCredential === true,
  ]);

const canonicalStatusRequest = (providerId: WebhookProviderId, status: 'ACTIVE' | 'INACTIVE', expectedRevision: number) =>
  JSON.stringify(['integration-request', 1, status === 'ACTIVE' ? 'activate' : 'deactivate', providerId, expectedRevision, status]);

const canonicalVerifyRequest = (providerId: WebhookProviderId, expectedRevision: number, confirmExternalSideEffect: boolean | undefined) =>
  JSON.stringify(['integration-request', 1, 'verify', providerId, expectedRevision, confirmExternalSideEffect === true]);

const authorizeIntegration = async (ctx: Context<HonoEnv>, projectId: string, scope: IntegrationScope, role: MemberRole) => {
  const apiKey = ctx.get('apiKey');
  if (apiKey) {
    const trustedKey = await prisma.apiKey.findFirst({
      where: { id: apiKey.id, projectId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true, projectId: true, scopes: true, project: { select: { organizationId: true } } },
    });
    if (!trustedKey) throw notFound('project', { id: projectId });
    if (!trustedKey.scopes.includes(scope)) {
      throw new AppError({ code: 'auth:insufficient_role', message: 'The integration scope is not granted.' });
    }
    return {
      organizationId: trustedKey.project.organizationId,
      principalId: trustedKey.id,
      principalType: 'api_key' as const,
    };
  }

  const user = ctx.get('user');
  if (!user) throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  const access = await assertProjectAccess(user.id, projectId);
  if (!roleAtLeast(access.role, role)) throw new AppError({ code: 'auth:insufficient_role' });
  return { organizationId: access.organizationId, principalId: user.id, principalType: 'session' as const };
};

const assertDashboardPrincipal = (principal: IntegrationAccess) => {
  if (principal.principalType !== 'session') {
    throw new AppError({ code: 'auth:insufficient_role', message: 'Credentials can only be managed from a dashboard session.' });
  }
};

const manifestOrThrow = (providerId: IntegrationProviderId) => {
  const manifest = getIntegrationManifest(providerId);
  if (!manifest) throw integrationError('integration:provider_unsupported', 'This integration provider is not supported.');
  return manifest;
};

const webhookPublicConfig = (providerId: WebhookProviderId, config: Prisma.JsonValue | null): IntegrationPublicConfig => {
  const parsed = webhookConfigSchema.safeParse(config);
  return { providerId, label: parsed.success ? parsed.data.label : null };
};

const webhookConnectionSummary = (connection: ProjectIntegration, providerId: WebhookProviderId): IntegrationConnectionSummary => ({
  id: connection.id,
  providerId,
  category: 'webhook',
  ownership: 'project',
  status: connection.status === 'ACTIVE' ? 'active' : connection.status === 'ERROR' ? 'error' : 'inactive',
  health: {
    status:
      connection.lastVerificationStatus === 'HEALTHY' ? 'healthy' : connection.lastVerificationStatus === 'UNHEALTHY' ? 'unhealthy' : 'unverified',
    checkedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    code: safeVerificationCode(connection.lastVerificationCode),
  },
  credential: { configured: true },
  config: webhookPublicConfig(providerId, connection.config),
  revision: connection.revision,
  createdAt: connection.createdAt.toISOString(),
  updatedAt: connection.updatedAt.toISOString(),
});

const adapterConnection = (
  projectId: string,
  config: IntegrationPublicConfig,
  createdAt: Date,
  options?: { id?: string; status?: 'active' | 'error'; credentialConfigured?: boolean; healthCode?: string | null },
): IntegrationConnectionSummary => {
  const manifest = manifestOrThrow(config.providerId);
  return {
    id: options?.id ?? `adapter:${projectId}:${config.providerId}`,
    providerId: config.providerId,
    category: manifest.category,
    ownership: manifest.ownership,
    status: options?.status ?? 'active',
    health: {
      status: options?.status === 'error' ? 'unhealthy' : 'unverified',
      checkedAt: null,
      code: options?.healthCode ?? null,
    },
    credential: manifest.authKind === 'none' ? null : { configured: options?.credentialConfigured ?? true },
    config,
    revision: 1,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };
};

const storageProviderId = () => {
  const provider = storageKeys().STORAGE_PROVIDER;
  if (provider === 's3') return 'amazon-s3' as const;
  if (provider === 'r2') return 'cloudflare-r2' as const;
  if (provider === 'b2') return 'backblaze-b2' as const;
  return provider;
};

const safeLegacyGitCloneUrl = (value: string | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.host) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return { cloneUrl: url.toString(), repository: `${url.host}${url.pathname}`.replace(/\/$/, '') };
  } catch {
    return null;
  }
};

const listAuthorizedProjectIntegrations = async (projectId: string): Promise<IntegrationCatalogEntry[]> => {
  const [project, webhookConnections, gitConnection] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, createdAt: true, config: true, organization: { select: { metadata: true } } },
    }),
    prisma.projectIntegration.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    prisma.gitConnection.findUnique({
      where: { projectId },
      select: {
        id: true,
        repository: true,
        baseBranch: true,
        headBranch: true,
        contentPath: true,
        credentialEncrypted: true,
        lastSyncStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  if (!project) throw notFound('project', { id: projectId });

  const connections = new Map<IntegrationProviderId, IntegrationConnectionSummary>();
  for (const connection of webhookConnections) {
    const providerId = configurableIntegrationProviderIdSchema.safeParse(connection.providerId);
    if (providerId.success) connections.set(providerId.data, webhookConnectionSummary(connection, providerId.data));
  }

  if (gitConnection) {
    connections.set('github', {
      id: gitConnection.id,
      providerId: 'github',
      category: 'source_control',
      ownership: 'project',
      status: gitConnection.lastSyncStatus === 'FAILED' ? 'error' : 'active',
      health: {
        status: gitConnection.lastSyncStatus === 'FAILED' ? 'unhealthy' : 'unverified',
        checkedAt: null,
        code: gitConnection.lastSyncStatus === 'FAILED' ? 'integration:verification_failed' : null,
      },
      credential: { configured: Boolean(gitConnection.credentialEncrypted) },
      config: {
        providerId: 'github',
        repository: gitConnection.repository,
        baseBranch: gitConnection.baseBranch,
        headBranch: gitConnection.headBranch,
        contentPath: gitConnection.contentPath,
      },
      revision: 1,
      createdAt: gitConnection.createdAt.toISOString(),
      updatedAt: gitConnection.updatedAt.toISOString(),
    });
  } else {
    const rawMetadataGit = legacyGitMetadataSchema.safeParse(parseWorkspaceMetadata(project.organization.metadata).git).data ?? {};
    const rawCloneUrl = z.string().safeParse(rawMetadataGit.cloneUrl).data;
    const safeCloneUrl = safeLegacyGitCloneUrl(rawCloneUrl);
    const metadataGit = gitConfigSchema.safeParse({
      ...rawMetadataGit,
      ...(safeCloneUrl ? { cloneUrl: safeCloneUrl.cloneUrl } : {}),
    });
    if (metadataGit.success && metadataGit.data.connected && metadataGit.data.provider) {
      const providerId = metadataGit.data.provider === 'git' ? 'public-git' : metadataGit.data.provider;
      const repository = metadataGit.data.repo ?? safeCloneUrl?.repository ?? '';
      if (providerId === 'github') {
        connections.set(
          providerId,
          adapterConnection(
            projectId,
            {
              providerId,
              repository,
              baseBranch: metadataGit.data.branch ?? 'main',
              headBranch: metadataGit.data.branch ?? 'main',
              contentPath: metadataGit.data.path ?? '',
            },
            project.createdAt,
          ),
        );
      } else {
        connections.set(
          providerId,
          adapterConnection(
            projectId,
            {
              providerId,
              repository,
              branch: metadataGit.data.branch ?? 'main',
              contentPath: metadataGit.data.path ?? '',
            },
            project.createdAt,
          ),
        );
      }
    }
  }

  const projectConfig = projectConfigSchema.safeParse(project.config);
  const analytics = projectConfig.success ? projectConfig.data.analytics : undefined;
  if (analytics?.ga4) {
    connections.set(
      'google-analytics',
      adapterConnection(projectId, { providerId: 'google-analytics', measurementId: analytics.ga4 }, project.createdAt),
    );
  }
  if (analytics?.plausible) {
    connections.set('plausible', adapterConnection(projectId, { providerId: 'plausible', domain: analytics.plausible }, project.createdAt));
  }

  if (env.OPENROUTER_API_KEY) {
    connections.set(
      'openrouter',
      adapterConnection(
        projectId,
        {
          providerId: 'openrouter',
          draftModel: env.AI_DRAFT_MODEL,
          embeddingModel: searchKeys().SEARCH_EMBEDDING_MODEL,
          answerModel: searchKeys().SEARCH_ANSWER_MODEL,
        },
        project.createdAt,
      ),
    );
  }
  const qdrant = qdrantKeys();
  if (qdrant.QDRANT_URL) {
    connections.set(
      'qdrant',
      adapterConnection(
        projectId,
        { providerId: 'qdrant', collectionAlias: qdrant.QDRANT_COLLECTION_ALIAS, searchRuntime: searchKeys().SEARCH_RUNTIME },
        project.createdAt,
      ),
    );
  }
  const clickhouse = clickHouseKeys();
  if (clickhouse.ANALYTICS_MODE !== 'disabled') {
    connections.set('clickhouse', adapterConnection(projectId, { providerId: 'clickhouse', mode: clickhouse.ANALYTICS_MODE }, project.createdAt));
  }
  if (env.POSTMARK_API_KEY) {
    connections.set(
      'postmark',
      adapterConnection(projectId, { providerId: 'postmark', messageStream: env.POSTMARK_MESSAGE_STREAM ?? null }, project.createdAt),
    );
  } else if (env.SMTP_URL) {
    connections.set('smtp', adapterConnection(projectId, { providerId: 'smtp' }, project.createdAt));
  }
  const storageId = storageProviderId();
  connections.set(storageId, adapterConnection(projectId, { providerId: storageId }, project.createdAt));
  if (env.CUSTOM_DOMAIN_PROVIDER === 'cloudflare-saas' && env.CLOUDFLARE_SAAS_ZONE_ID && env.CLOUDFLARE_SAAS_API_TOKEN) {
    connections.set(
      'cloudflare',
      adapterConnection(projectId, { providerId: 'cloudflare', workerScript: env.CLOUDFLARE_SAAS_WORKER_SCRIPT }, project.createdAt),
    );
  }

  return INTEGRATION_CATALOG.map((manifest) => ({
    ...manifest,
    availability:
      manifest.lifecycle !== 'managed' || connections.has(manifest.id)
        ? 'available'
        : ['openrouter', 'qdrant', 'clickhouse', 'postmark', 'smtp', 'cloudflare'].includes(manifest.id)
          ? 'not_configured'
          : 'unavailable',
    connection: connections.get(manifest.id) ?? null,
  }));
};

export const listProjectIntegrations = async (ctx: Context<HonoEnv>, projectId: string) => {
  await authorizeIntegration(ctx, projectId, 'integrations:read', MemberRole.MEMBER);
  return listAuthorizedProjectIntegrations(projectId);
};

export const getProjectIntegration = async (ctx: Context<HonoEnv>, projectId: string, providerId: IntegrationProviderId) => {
  await authorizeIntegration(ctx, projectId, 'integrations:read', MemberRole.MEMBER);
  const entry = (await listAuthorizedProjectIntegrations(projectId)).find((candidate) => candidate.id === providerId);
  if (!entry) throw integrationError('integration:not_found', 'Integration not found.');
  return entry;
};

const configurableManifest = (providerId: WebhookProviderId) => {
  const manifest = manifestOrThrow(providerId);
  if (manifest.lifecycle !== 'configurable') {
    throw integrationError('integration:provider_unsupported', 'This provider does not use the configurable connection lifecycle.');
  }
  return manifest;
};

const createAuditEvent = (
  tx: Prisma.TransactionClient,
  access: IntegrationAccess,
  projectId: string,
  providerId: IntegrationProviderId,
  action: string,
  result: string,
  options?: { connectionId?: string; code?: string; metadata?: Prisma.InputJsonValue },
) =>
  tx.integrationAuditEvent.create({
    data: {
      projectId,
      providerId,
      organizationId: access.organizationId,
      principalType: access.principalType,
      principalId: access.principalId,
      action,
      result,
      ...(options?.connectionId ? { connectionId: options.connectionId } : {}),
      ...(options?.code ? { code: options.code } : {}),
      ...(options?.metadata ? { metadata: options.metadata } : {}),
    },
  });

const getIdempotentConnection = async (
  projectId: string,
  providerId: WebhookProviderId,
  action: 'create' | 'update' | 'activate' | 'deactivate',
  idempotencyKey: string,
  requestValue: string,
) => {
  const keyDigests = digestIntegrationValueCandidates(idempotencyKey, 'idempotency-key');
  const record = await prisma.integrationIdempotencyRecord.findFirst({
    where: { projectId, providerId, action, keyDigest: { in: keyDigests } },
    orderBy: { createdAt: 'desc' },
  });
  if (!record || record.expiresAt <= new Date()) return null;
  const requestDigests = digestIntegrationValueCandidates(requestValue, 'request');
  if (!requestDigests.includes(record.requestDigest)) {
    throw integrationError('integration:idempotency_conflict', 'The idempotency key was already used for a different request.');
  }
  return integrationConnectionSummarySchema.parse(record.result);
};

const createIdempotencyRecord = async (
  tx: Prisma.TransactionClient,
  projectId: string,
  providerId: WebhookProviderId,
  action: 'create' | 'update' | 'activate' | 'deactivate',
  keyDigest: string,
  requestDigest: string,
  connection: ProjectIntegration,
  result: IntegrationConnectionSummary,
) => {
  await tx.integrationIdempotencyRecord.deleteMany({ where: { projectId, expiresAt: { lte: new Date() } } });
  return tx.integrationIdempotencyRecord.create({
    data: {
      projectId,
      providerId,
      action,
      keyDigest,
      requestDigest,
      connectionId: connection.id,
      resultRevision: connection.revision,
      result: integrationConnectionSummarySchema.parse(result),
      expiresAt: new Date(Date.now() + env.INTEGRATION_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000),
    },
  });
};

export const createProjectIntegration = async (ctx: Context<HonoEnv>, projectId: string, body: CreateProjectIntegrationBody) => {
  const access = await authorizeIntegration(ctx, projectId, 'integrations:write', MemberRole.ADMIN);
  assertDashboardPrincipal(access);
  configurableManifest(body.providerId);
  const requestValue = canonicalCreateRequest(body);
  const idempotencyDigest = digestIntegrationValue(body.idempotencyKey, 'idempotency-key');
  const requestDigest = digestIntegrationValue(requestValue, 'request');
  const replay = await getIdempotentConnection(projectId, body.providerId, 'create', body.idempotencyKey, requestValue);
  if (replay) return replay;
  const existing = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId: body.providerId } } });
  if (existing) {
    throw integrationError('integration:already_connected', 'This provider is already connected.');
  }
  try {
    const connection = await prisma.$transaction(async (tx) => {
      const created = await tx.projectIntegration.create({
        data: {
          projectId,
          providerId: body.providerId,
          config: { label: body.label ?? null },
          credentialEncrypted: encryptIntegrationSecret(body.webhookUrl),
          createdById: access.principalId,
        },
      });
      const result = webhookConnectionSummary(created, body.providerId);
      await createIdempotencyRecord(tx, projectId, body.providerId, 'create', idempotencyDigest, requestDigest, created, result);
      await createAuditEvent(tx, access, projectId, body.providerId, 'create', 'success', {
        connectionId: created.id,
        metadata: { idempotencyDigest },
      });
      return result;
    });
    return connection;
  } catch (error) {
    const concurrentReplay = await getIdempotentConnection(projectId, body.providerId, 'create', body.idempotencyKey, requestValue);
    if (concurrentReplay) return concurrentReplay;
    if (error instanceof AppError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw integrationError('integration:already_connected', 'This provider is already connected.');
    }
    throw error;
  }
};

export const updateProjectIntegration = async (
  ctx: Context<HonoEnv>,
  projectId: string,
  providerId: WebhookProviderId,
  body: UpdateProjectIntegrationBody,
) => {
  const access = await authorizeIntegration(ctx, projectId, 'integrations:write', MemberRole.ADMIN);
  assertDashboardPrincipal(access);
  if (body.providerId !== providerId) throw integrationError('integration:invalid_configuration', 'The provider configuration is invalid.');
  configurableManifest(providerId);
  const requestValue = canonicalUpdateRequest(providerId, body);
  const idempotencyDigest = digestIntegrationValue(body.idempotencyKey, 'idempotency-key');
  const requestDigest = digestIntegrationValue(requestValue, 'request');
  const replay = await getIdempotentConnection(projectId, providerId, 'update', body.idempotencyKey, requestValue);
  if (replay) return replay;
  const existing = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId } } });
  if (!existing) throw integrationError('integration:not_found', 'Integration not found.');
  if (existing.revision !== body.expectedRevision) {
    throw integrationError('integration:revision_conflict', 'The integration changed. Refresh and try again.');
  }
  const currentConfig = webhookConfigSchema.safeParse(existing.config);
  try {
    const connection = await prisma.$transaction(async (tx) => {
      const [updated] = await tx.projectIntegration.updateManyAndReturn({
        where: { id: existing.id, revision: body.expectedRevision },
        data: {
          config: { label: body.label === undefined ? (currentConfig.success ? currentConfig.data.label : null) : body.label },
          ...(body.webhookUrl ? { credentialEncrypted: encryptIntegrationSecret(body.webhookUrl) } : {}),
          revision: { increment: 1 },
          lastVerificationStatus: body.webhookUrl ? 'UNVERIFIED' : existing.lastVerificationStatus,
          lastVerificationCode: body.webhookUrl ? null : existing.lastVerificationCode,
          lastVerifiedAt: body.webhookUrl ? null : existing.lastVerifiedAt,
        },
      });
      if (!updated) throw integrationError('integration:revision_conflict', 'The integration changed. Refresh and try again.');
      const result = webhookConnectionSummary(updated, providerId);
      await createIdempotencyRecord(tx, projectId, providerId, 'update', idempotencyDigest, requestDigest, updated, result);
      await createAuditEvent(tx, access, projectId, providerId, body.webhookUrl ? 'reconnect' : 'update', 'success', {
        connectionId: existing.id,
        metadata: { idempotencyDigest, credentialReplaced: Boolean(body.webhookUrl) },
      });
      return result;
    });
    return connection;
  } catch (error) {
    const concurrentReplay = await getIdempotentConnection(projectId, providerId, 'update', body.idempotencyKey, requestValue);
    if (concurrentReplay) return concurrentReplay;
    if (error instanceof AppError) throw error;
    throw error;
  }
};

const setProjectIntegrationStatus = async (
  ctx: Context<HonoEnv>,
  projectId: string,
  providerId: WebhookProviderId,
  body: IntegrationRevisionBody,
  status: 'ACTIVE' | 'INACTIVE',
) => {
  const access = await authorizeIntegration(ctx, projectId, 'integrations:write', MemberRole.ADMIN);
  configurableManifest(providerId);
  const requestValue = canonicalStatusRequest(providerId, status, body.expectedRevision);
  const idempotencyDigest = digestIntegrationValue(body.idempotencyKey, 'idempotency-key');
  const requestDigest = digestIntegrationValue(requestValue, 'request');
  const action = status === 'ACTIVE' ? 'activate' : 'deactivate';
  const replay = await getIdempotentConnection(projectId, providerId, action, body.idempotencyKey, requestValue);
  if (replay) return replay;
  const existing = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId } } });
  if (!existing) throw integrationError('integration:not_found', 'Integration not found.');
  if (existing.revision !== body.expectedRevision) {
    throw integrationError('integration:revision_conflict', 'The integration changed. Refresh and try again.');
  }
  try {
    const connection = await prisma.$transaction(async (tx) => {
      const [updated] = await tx.projectIntegration.updateManyAndReturn({
        where: { id: existing.id, revision: body.expectedRevision },
        data: { status, revision: { increment: 1 } },
      });
      if (!updated) throw integrationError('integration:revision_conflict', 'The integration changed. Refresh and try again.');
      const result = webhookConnectionSummary(updated, providerId);
      await createIdempotencyRecord(tx, projectId, providerId, action, idempotencyDigest, requestDigest, updated, result);
      await createAuditEvent(tx, access, projectId, providerId, action, 'success', {
        connectionId: existing.id,
        metadata: { idempotencyDigest },
      });
      return result;
    });
    return connection;
  } catch (error) {
    const concurrentReplay = await getIdempotentConnection(projectId, providerId, action, body.idempotencyKey, requestValue);
    if (concurrentReplay) return concurrentReplay;
    if (error instanceof AppError) throw error;
    throw error;
  }
};

export const activateProjectIntegration = (ctx: Context<HonoEnv>, projectId: string, providerId: WebhookProviderId, body: IntegrationRevisionBody) =>
  setProjectIntegrationStatus(ctx, projectId, providerId, body, 'ACTIVE');

export const deactivateProjectIntegration = (
  ctx: Context<HonoEnv>,
  projectId: string,
  providerId: WebhookProviderId,
  body: IntegrationRevisionBody,
) => setProjectIntegrationStatus(ctx, projectId, providerId, body, 'INACTIVE');

const verifyGitHubConnection = async (projectId: string) => {
  const connection = await prisma.gitConnection.findUnique({
    where: { projectId },
    select: { credentialEncrypted: true, repository: true },
  });
  if (!connection?.credentialEncrypted) throw integrationError('integration:credentials_required', 'GitHub credentials are not configured.');
  const provider = new GitHubProvider(decryptGitSecret(connection.credentialEncrypted));
  await provider.verifyIdentity();
  await provider.verifyWriteAccess(connection.repository);
};

export const verifyProjectIntegration = async (
  ctx: Context<HonoEnv>,
  projectId: string,
  providerId: IntegrationProviderId,
  body: VerifyProjectIntegrationBody,
) => {
  const access = await authorizeIntegration(ctx, projectId, 'integrations:verify', MemberRole.ADMIN);
  if (body.providerId !== providerId) {
    throw integrationError('integration:invalid_configuration', 'The verification provider does not match the route.');
  }
  const manifest = manifestOrThrow(providerId);
  if (!(manifest.supportsPassiveVerification || manifest.verificationSideEffect)) {
    throw integrationError('integration:provider_unsupported', 'This provider does not expose project-level verification.');
  }

  if (body.providerId === 'github') {
    try {
      await verifyGitHubConnection(projectId);
      const entry = (await listAuthorizedProjectIntegrations(projectId)).find((candidate) => candidate.id === body.providerId);
      if (!entry) throw integrationError('integration:not_found', 'Integration not found.');
      await prisma.$transaction((tx) =>
        createAuditEvent(tx, access, projectId, body.providerId, 'verify', 'success', { metadata: { passive: true } }),
      );
      return entry;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'integration:verification_failed';
      await prisma.$transaction((tx) =>
        createAuditEvent(tx, access, projectId, body.providerId, 'verify', 'failed', { code, metadata: { passive: true } }),
      );
      if (error instanceof AppError) throw error;
      throw integrationError('integration:verification_failed', 'GitHub verification failed.');
    }
  }

  if (manifest.verificationSideEffect && body.confirmExternalSideEffect !== true) {
    throw integrationError('integration:external_confirmation_required', 'This provider sends a visible test event and requires confirmation.');
  }
  if (access.principalType === 'api_key' && manifest.verificationSideEffect) {
    throw integrationError('integration:external_confirmation_required', 'MCP cannot send provider-visible test events.');
  }

  const webhookProviderId = body.providerId;
  const existing = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId: webhookProviderId } } });
  if (!existing) throw integrationError('integration:not_found', 'Integration not found.');
  if (existing.status !== 'ACTIVE') throw integrationError('integration:inactive', 'Activate the integration before verification.');
  const requestValue = canonicalVerifyRequest(webhookProviderId, body.expectedRevision, body.confirmExternalSideEffect);
  const idempotencyDigests = digestIntegrationValueCandidates(body.idempotencyKey, 'idempotency-key');
  const idempotencyDigest = digestIntegrationValue(body.idempotencyKey, 'idempotency-key');
  const requestDigests = digestIntegrationValueCandidates(requestValue, 'request');
  const requestDigest = digestIntegrationValue(requestValue, 'request');
  const previous = await prisma.integrationWebhookDelivery.findFirst({
    where: { connectionId: existing.id, idempotencyDigest: { in: idempotencyDigests } },
    orderBy: { createdAt: 'desc' },
  });
  if (previous && !requestDigests.includes(previous.requestDigest)) {
    throw integrationError('integration:idempotency_conflict', 'The idempotency key was already used for a different request.');
  }
  if (previous) {
    const replay = replayVerificationDelivery(previous);
    if (replay) return replay;
  }

  const replayLatestDelivery = async (deliveryId: string) => {
    const latest = await prisma.integrationWebhookDelivery.findFirst({ where: { id: deliveryId } });
    if (latest) {
      const replay = replayVerificationDelivery(latest);
      if (replay) return replay;
    }
    throw integrationError('integration:rate_limited', 'Verification is already in progress.');
  };

  const claimStartedAt = new Date();
  const staleBefore = new Date(claimStartedAt.getTime() - VERIFICATION_RUNNING_LEASE_MS);
  let delivery = previous;

  if (delivery?.status === 'RUNNING') {
    const runningDelivery = delivery;
    const leaseStartedAt = runningDelivery.startedAt ?? runningDelivery.createdAt;
    if (leaseStartedAt > staleBefore) {
      throw integrationError('integration:rate_limited', 'Verification is already in progress.');
    }
    if (manifest.verificationSideEffect) {
      const finalized = await prisma.$transaction(async (tx) => {
        const claimed = await tx.integrationWebhookDelivery.updateMany({
          where: staleRunningDeliveryWhere(runningDelivery, staleBefore),
          data: { status: 'FAILED', completedAt: claimStartedAt, errorCode: 'integration:provider_unavailable' },
        });
        if (claimed.count === 0) return false;
        await createAuditEvent(tx, access, projectId, webhookProviderId, 'verify', 'failed', {
          connectionId: existing.id,
          code: 'integration:provider_unavailable',
          metadata: { externalSideEffect: true, recovery: 'unknown_delivery' },
        });
        return true;
      });
      if (finalized) {
        throw integrationError('integration:provider_unavailable', 'The prior provider-visible verification outcome is unknown.');
      }
      return replayLatestDelivery(runningDelivery.id);
    }
  }

  const canClaimPending = delivery?.status === 'PENDING';
  const canReclaimPassive = delivery?.status === 'RUNNING' && !manifest.verificationSideEffect;
  if (delivery && !(canClaimPending || canReclaimPassive)) {
    throw integrationError('integration:rate_limited', 'Verification is already in progress.');
  }
  if (existing.revision !== body.expectedRevision) {
    if (delivery) {
      const where = canClaimPending ? { id: delivery.id, status: 'PENDING' } : staleRunningDeliveryWhere(delivery, staleBefore);
      const finalized = await prisma.$transaction(async (tx) => {
        const claimed = await tx.integrationWebhookDelivery.updateMany({
          where,
          data: { status: 'FAILED', completedAt: claimStartedAt, errorCode: 'integration:revision_conflict' },
        });
        if (claimed.count === 0) return false;
        await createAuditEvent(tx, access, projectId, webhookProviderId, 'verify', 'failed', {
          connectionId: existing.id,
          code: 'integration:revision_conflict',
          metadata: { externalSideEffect: false, recovery: 'revision_conflict' },
        });
        return true;
      });
      if (!finalized) return replayLatestDelivery(delivery.id);
    }
    throw integrationError('integration:revision_conflict', 'The integration changed. Refresh and try again.');
  }

  if (!delivery) {
    delivery = await prisma.integrationWebhookDelivery
      .create({
        data: { connectionId: existing.id, event: 'integration.test', idempotencyDigest, requestDigest },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw integrationError('integration:rate_limited', 'Verification is already in progress.');
        }
        throw error;
      });
  }

  const claimed = await prisma.integrationWebhookDelivery.updateMany({
    where: canReclaimPassive ? staleRunningDeliveryWhere(delivery, staleBefore) : { id: delivery.id, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: claimStartedAt, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return replayLatestDelivery(delivery.id);

  let providerResult:
    | { ok: true; responseStatus: number | null }
    | { ok: false; code: 'integration:credentials_invalid' | 'integration:provider_unavailable' };
  try {
    const result = await verifyWebhookProvider(webhookProviderId, decryptIntegrationSecret(existing.credentialEncrypted), ctx.get('locale'));
    providerResult = { ok: true, responseStatus: result.responseStatus };
  } catch (error) {
    providerResult = {
      ok: false,
      code: error instanceof AppError ? 'integration:provider_unavailable' : 'integration:credentials_invalid',
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const terminalClaim = await tx.integrationWebhookDelivery.updateMany({
      where: { id: delivery.id, status: 'RUNNING', startedAt: claimStartedAt },
      data: { status: 'FINALIZING' },
    });
    if (terminalClaim.count === 0) return { status: 'delivery_lost' as const };
    const [updated] = await tx.projectIntegration.updateManyAndReturn({
      where: { id: existing.id, revision: body.expectedRevision },
      data: providerResult.ok
        ? { revision: { increment: 1 }, lastVerificationStatus: 'HEALTHY', lastVerificationCode: null, lastVerifiedAt: new Date() }
        : {
            revision: { increment: 1 },
            lastVerificationStatus: 'UNHEALTHY',
            lastVerificationCode: providerResult.code,
            lastVerifiedAt: new Date(),
          },
    });
    if (!updated) {
      await tx.integrationWebhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', completedAt: new Date(), errorCode: 'integration:revision_conflict' },
      });
      await createAuditEvent(tx, access, projectId, webhookProviderId, 'verify', 'failed', {
        code: 'integration:revision_conflict',
        metadata: { providerId: webhookProviderId, idempotencyDigest },
      });
      return { status: 'revision_conflict' as const };
    }
    const result = webhookConnectionSummary(updated, webhookProviderId);
    await tx.integrationWebhookDelivery.update({
      where: { id: delivery.id },
      data: providerResult.ok
        ? {
            status: 'SUCCEEDED',
            responseStatus: providerResult.responseStatus,
            completedAt: new Date(),
            errorCode: null,
            result: integrationConnectionSummarySchema.parse(result),
          }
        : { status: 'FAILED', completedAt: new Date(), errorCode: providerResult.code },
    });
    await createAuditEvent(tx, access, projectId, webhookProviderId, 'verify', providerResult.ok ? 'success' : 'failed', {
      connectionId: existing.id,
      ...(providerResult.ok ? {} : { code: providerResult.code }),
      metadata: { idempotencyDigest, externalSideEffect: manifest.verificationSideEffect },
    });
    return providerResult.ok ? { status: 'success' as const, result } : { status: 'provider_failure' as const, code: providerResult.code };
  });
  if (outcome.status === 'revision_conflict') {
    throw integrationError('integration:revision_conflict', 'The integration changed during verification.');
  }
  if (outcome.status === 'delivery_lost') return replayLatestDelivery(delivery.id);
  if (outcome.status === 'provider_failure') {
    throw integrationError(outcome.code, 'The provider could not verify this connection.');
  }
  return outcome.result;
};

export const createIntegrationDeleteConfirmation = async (
  ctx: Context<HonoEnv>,
  projectId: string,
  providerId: WebhookProviderId,
  body: CreateIntegrationDeleteConfirmationBody,
) => {
  const access = await authorizeIntegration(ctx, projectId, 'integrations:delete', MemberRole.ADMIN);
  assertDashboardPrincipal(access);
  const connection = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId } } });
  if (!connection) throw integrationError('integration:not_found', 'Integration not found.');
  if (connection.revision !== body.expectedRevision) {
    throw integrationError('integration:revision_conflict', 'The integration changed. Refresh and try again.');
  }
  const targetPrincipal = body.apiKeyId
    ? await prisma.apiKey.findFirst({
        where: { id: body.apiKeyId, projectId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { id: true, scopes: true },
      })
    : null;
  if (body.apiKeyId && !targetPrincipal) throw notFound('api key', { id: body.apiKeyId });
  if (targetPrincipal && !targetPrincipal.scopes.includes('integrations:delete')) {
    throw new AppError({ code: 'auth:insufficient_role', message: 'The API key is not allowed to delete integrations.' });
  }
  const token = newIntegrationConfirmationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.INTEGRATION_CONFIRMATION_TTL_SECONDS * 1000);
  const consumedBefore = new Date(now.getTime() - env.INTEGRATION_CONFIRMATION_RETENTION_HOURS * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.integrationConfirmation.deleteMany({
      where: {
        projectId,
        OR: [{ consumedAt: { lte: consumedBefore } }, { consumedAt: null, expiresAt: { lte: now } }],
      },
    });
    await tx.integrationConfirmation.create({
      data: {
        projectId,
        connectionId: connection.id,
        providerId,
        connectionRevision: connection.revision,
        principalType: targetPrincipal ? 'api_key' : 'session',
        principalId: targetPrincipal?.id ?? access.principalId,
        tokenDigest: digestIntegrationValue(token, 'confirmation'),
        expiresAt,
        createdById: access.principalId,
      },
    });
    await createAuditEvent(tx, access, projectId, providerId, 'create_delete_confirmation', 'success', {
      connectionId: connection.id,
      metadata: { targetPrincipalType: targetPrincipal ? 'api_key' : 'session' },
    });
  });
  return { confirmationToken: token, expiresAt: expiresAt.toISOString() };
};

export const deleteProjectIntegration = async (
  ctx: Context<HonoEnv>,
  projectId: string,
  providerId: WebhookProviderId,
  body: DeleteProjectIntegrationBody,
) => {
  const access = await authorizeIntegration(ctx, projectId, 'integrations:delete', MemberRole.ADMIN);
  const tokenDigests = digestIntegrationValueCandidates(body.confirmationToken, 'confirmation');
  return prisma.$transaction(async (tx) => {
    const confirmation = await tx.integrationConfirmation.findFirst({ where: { tokenDigest: { in: tokenDigests } } });
    if (
      !confirmation ||
      confirmation.projectId !== projectId ||
      confirmation.providerId !== providerId ||
      confirmation.principalType !== access.principalType ||
      confirmation.principalId !== access.principalId
    ) {
      throw integrationError('integration:confirmation_invalid', 'The delete confirmation is invalid for this connection.');
    }
    if (confirmation.consumedAt) {
      throw integrationError('integration:confirmation_consumed', 'The delete confirmation was already used.');
    }
    if (confirmation.expiresAt <= new Date()) {
      throw integrationError('integration:confirmation_expired', 'The delete confirmation expired.');
    }
    if (!confirmation.connectionId) throw integrationError('integration:not_found', 'Integration not found.');
    const connection = await tx.projectIntegration.findUnique({ where: { id: confirmation.connectionId } });
    if (!connection) throw integrationError('integration:not_found', 'Integration not found.');
    if (connection.revision !== confirmation.connectionRevision) {
      throw integrationError('integration:revision_conflict', 'The integration changed after confirmation.');
    }
    const claim = await tx.integrationConfirmation.updateMany({
      where: { id: confirmation.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claim.count === 0) {
      throw integrationError('integration:confirmation_consumed', 'The delete confirmation was already used.');
    }
    await createAuditEvent(tx, access, projectId, providerId, 'delete', 'success', {
      connectionId: connection.id,
      metadata: { confirmedBy: confirmation.createdById },
    });
    await tx.projectIntegration.delete({ where: { id: connection.id } });
    return { providerId, deleted: true as const };
  });
};
