import { Prisma, type ProjectIntegration, prisma } from '@nibleaf/database';
import { getQdrantClient } from '@nibleaf/qdrant';
import { aiConnectionConfigSchema, aiCredentialSchema, aiModelLabel, aiProviderIdSchema, aiSelectionSchema } from '@nibleaf/shared/ai';
import { MemberRole } from '@nibleaf/shared/constants';
import { canView, roleAtLeast } from '@nibleaf/shared/rbac';
import {
  type SaveWorkspaceAiConnectionBody,
  type SiteAiCapabilities,
  type SiteAiStatus,
  saveWorkspaceAiConnectionBody,
  type WorkspaceAiModelsBody,
  type WorkspaceAiSelectionBody,
  workspaceAiModelsBody,
  workspaceAiOverviewSchema,
  workspaceAiSelectionBody,
} from '@nibleaf/validators';
import type { Context } from 'hono';
import { z } from 'zod';
import { env } from '@/env';
import { AppError, conflict, forbidden } from '@/errors';
import { readAnswerQuota } from '@/lib/ai-search/quota';
import { findCurrentIndexRun, type ServedIndexState, servedIndexState } from '@/lib/ai-search/readiness';
import type { HonoEnv } from '@/lib/hono/context';
import { managedAiServes, siteAiSelection, storedAiKeyFailure, storedAiKeyState } from './ai-source';
import { decryptIntegrationSecret, encryptIntegrationSecret } from './integrations/crypto';
import { updateProjectConfigSection } from './project-config';
import { assertProjectAccess } from './projects';
import { invalidatePublishedSiteConfig } from './sites';

const providerModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(),
      supported_parameters: z.array(z.string()).optional(),
    }),
  ),
});
const keyMetadataSchema = z.object({ data: z.object({ is_management_key: z.boolean().optional(), is_provisioning_key: z.boolean().optional() }) });
const selectionSchema = z.object({
  search: z.object({ aiProvider: aiSelectionSchema.optional(), aiAnswers: z.boolean().optional() }).optional(),
});

/** Anyone on the site may read where AI answers stand; API keys may not (dashboard only). */
const authorizeRead = async (ctx: Context<HonoEnv>, projectId: string) => {
  if (ctx.get('apiKey')) throw forbidden('AI settings require a dashboard session.');
  const user = ctx.get('user');
  if (!user) throw new AppError({ code: 'auth:no_user' });
  const access = await assertProjectAccess(user.id, projectId);
  if (!canView(access.role)) throw forbidden('Site access is required.');
  return { ...access, actorId: user.id, canManage: roleAtLeast(access.role, MemberRole.ADMIN) };
};

/** Changing AI settings, keys or models is for site Admins. */
const authorize = async (ctx: Context<HonoEnv>, projectId: string) => {
  if (ctx.get('apiKey')) throw forbidden('AI credentials require a dashboard administrator session.');
  const access = await authorizeRead(ctx, projectId);
  if (!access.canManage) throw forbidden('Administrator access is required.');
  return access;
};

const readCredential = (projectId: string, providerId: z.infer<typeof aiProviderIdSchema>, ciphertext: string) => {
  try {
    const value = aiCredentialSchema.parse(JSON.parse(decryptIntegrationSecret(ciphertext)));
    if (value.projectId === projectId && value.providerId === providerId) return value.apiKey;
  } catch {
    /* Use the same secret-free error for invalid envelopes and bindings. */
  }
  throw new AppError({ code: 'integration:credentials_invalid' });
};

const credentialReadable = (projectId: string, providerId: z.infer<typeof aiProviderIdSchema>, ciphertext: string) => {
  try {
    readCredential(projectId, providerId, ciphertext);
    return true;
  } catch {
    return false;
  }
};

/** Direct OpenAI chat models the picker offers: the GPT-6 family and newer,
 * without the non-chat and Responses-only variants. */
const offeredOpenAiModel = (id: string) =>
  Number(/^gpt-(\d+)(?:[.-]|$)/.exec(id)?.[1] ?? 0) >= 6 &&
  !/embedding|audio|realtime|image|transcri|tts|codex|deep-research|search|pro(?:-|$)/.test(id);

/** Fixed provider origins, bounded GET-only checks, and allowlisted response
 * fields. Never expose an SDK error containing authorization headers or a key.
 * `saved` is the connection's current model: it stays offered while the
 * provider still lists it, so a site that chose an older model keeps it. */
const discoverAiProviderModels = async (providerId: z.infer<typeof aiProviderIdSchema>, apiKey: string, saved?: string) => {
  const base = providerId === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const get = async (path: string) => {
    const response = await fetch(base + path, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) throw new AppError({ code: 'integration:credentials_invalid' });
    if (!response.ok) throw new AppError({ code: 'integration:provider_unavailable' });
    return response.json();
  };
  try {
    if (providerId === 'openrouter') {
      const key = keyMetadataSchema.parse(await get('/key'));
      if (key.data.is_management_key || key.data.is_provisioning_key) throw new AppError({ code: 'integration:credentials_invalid' });
    }
    const catalog = providerModelsSchema.parse(await get('/models'));
    const embeddingId = providerId === 'openai' ? env.SEARCH_EMBEDDING_MODEL.replace(/^openai\//, '') : env.SEARCH_EMBEDDING_MODEL;
    const embeddings = providerId === 'openrouter' ? providerModelsSchema.parse(await get('/embeddings/models')) : catalog;
    if (!embeddings.data.some((model) => model.id === embeddingId))
      throw new AppError({
        code: 'integration:provider_unavailable',
        message: 'The configured embedding model is not available for this connection.',
      });
    if (providerId === 'openai' && !env.SEARCH_EMBEDDING_MODEL.startsWith('openai/'))
      throw new AppError({ code: 'integration:provider_unavailable', message: 'This instance uses an embedding model that requires OpenRouter.' });
    return catalog.data
      .filter((model) =>
        providerId === 'openai'
          ? model.id === saved || offeredOpenAiModel(model.id)
          : model.architecture?.output_modalities?.includes('text') &&
            (model.supported_parameters?.includes('response_format') || model.supported_parameters?.includes('structured_outputs')),
      )
      .map((model) => ({ id: model.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({ code: 'integration:provider_unavailable', message: 'The provider could not verify this connection.' });
  }
};

const savedAnswerModel = (config: unknown) => {
  const parsed = aiConnectionConfigSchema.safeParse(config);
  return parsed.success ? parsed.data.answerModel : undefined;
};

/** What this server can offer a site, from runtime configuration only (no Cloud or self-hosted branch). */
const siteAiCapabilities = (served: ServedIndexState | null): SiteAiCapabilities => {
  const credentialStorage = Boolean(env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY);
  const openAiEmbeddings = env.SEARCH_EMBEDDING_MODEL.startsWith('openai/');
  return {
    managed: {
      available: managedAiServes(),
      reason: !env.OPENROUTER_API_KEY
        ? 'noServerKey'
        : !env.SEARCH_ANSWER_ENABLED
          ? 'answersDisabledOnServer'
          : env.SEARCH_ANSWER_DAILY_PER_PROJECT > 0
            ? null
            : 'noDailyAnswers',
      model: env.OPENROUTER_API_KEY ? { id: env.SEARCH_ANSWER_MODEL, label: aiModelLabel(env.SEARCH_ANSWER_MODEL) } : null,
      dailyAnswerLimit: env.SEARCH_ANSWER_DAILY_PER_PROJECT,
    },
    ownKey: { available: credentialStorage, reason: credentialStorage ? null : 'credentialStorageMissing' },
    providers: [
      {
        id: 'openai',
        available: credentialStorage && openAiEmbeddings,
        reason: !credentialStorage ? 'credentialStorageMissing' : openAiEmbeddings ? null : 'embeddingModelRequiresOpenRouter',
      },
      { id: 'openrouter', available: credentialStorage, reason: credentialStorage ? null : 'credentialStorageMissing' },
    ],
    // Whether this server supports AI answers, not whether the index serves them right now:
    // a new server with no index yet (`empty`) can still prepare its first one, and a
    // reading that failed just now isn't a reason to block settings. The reader itself
    // stays fail-closed (`configuredIndexServing`). Only search that is missing, or that
    // serves a collection built for other settings, makes answers unavailable.
    answers:
      served === null
        ? { available: false, reason: 'searchNotConfigured' }
        : served === 'other'
          ? { available: false, reason: 'searchIndexSwitching' }
          : { available: true, reason: null },
  };
};

const PREPARATION_STATE = { PENDING: 'running', RUNNING: 'running', FAILED: 'failed', DISABLED: 'none' } as const;

type CurrentRun = {
  status: keyof typeof PREPARATION_STATE | 'READY';
  indexedPages: number;
  indexedChunks: number;
  expectedPages: number;
  failedChunks: number;
  completedAt: Date | null;
};

/** How far the docs are prepared for AI, from the run that indexed the served collection (see `readiness.ts`). */
const preparationOf = (run: CurrentRun | null): SiteAiStatus['preparation'] => {
  const pages = run?.indexedPages ?? 0;
  const expectedPages = Math.max(run?.expectedPages ?? 0, pages);
  const at = run?.completedAt?.toISOString() ?? null;
  if (!run) return { state: 'none', pages, expectedPages, at };
  if (run.status !== 'READY') return { state: PREPARATION_STATE[run.status], pages, expectedPages, at };
  if (run.indexedChunks === 0) return { state: 'none', pages, expectedPages, at };
  return { state: run.failedChunks > 0 || pages < expectedPages ? 'partial' : 'ready', pages, expectedPages, at };
};

/**
 * Where the site's AI answers stand. Never carries a key: Admins get its last
 * four characters, stored at save time; a failed check is a code, never
 * provider text.
 */
const siteAiStatus = (
  projectConfig: unknown,
  projectId: string,
  connections: ProjectIntegration[],
  deployment: { version: number; completedAt: Date | null } | null,
  run: CurrentRun | null,
  usage: SiteAiStatus['usage'],
  canManage: boolean,
): SiteAiStatus => {
  const selection = siteAiSelection(projectConfig);
  const keys = connections.flatMap((connection) => {
    const id = aiProviderIdSchema.safeParse(connection.providerId);
    return id.success && connection.projectId === projectId ? [{ id: id.data, connection }] : [];
  });
  const stored = keys.map(({ id, connection }) => {
    const answerModel = aiConnectionConfigSchema.safeParse(connection.config).data?.answerModel;
    const failure = storedAiKeyFailure(connection);
    return {
      id,
      revision: connection.revision,
      state: storedAiKeyState(connection, id),
      failure: failure ? { reason: failure, checkedAt: connection.lastVerifiedAt?.toISOString() ?? null } : null,
      keyHint: canManage ? (connection.credentialHint ?? null) : null,
      addedAt: connection.credentialAddedAt?.toISOString() ?? null,
      model: answerModel ? { id: answerModel, label: aiModelLabel(answerModel) } : null,
    };
  });
  const source = selection.source === 'disabled' ? null : selection.source === 'instance' ? 'managed' : selection.source;
  return {
    answersOn: selection.answersOn && source !== null,
    source,
    sourceReady: source === 'managed' ? managedAiServes() : source ? stored.some((key) => key.id === source && key.state === 'ok') : false,
    connections: stored,
    published: deployment ? { version: deployment.version, at: deployment.completedAt?.toISOString() ?? null } : null,
    preparation: preparationOf(run),
    usage,
  };
};

export const getWorkspaceAi = async (ctx: Context<HonoEnv>, projectId: string) => {
  const { project, canManage } = await authorizeRead(ctx, projectId);
  const [connections, deployment] = await Promise.all([
    prisma.projectIntegration.findMany({ where: { projectId, providerId: { in: ['openai', 'openrouter'] } } }),
    prisma.deployment.findFirst({
      where: { projectId, status: 'READY' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, completedAt: true },
    }),
  ]);
  // The same run and served-collection checks the reader uses before it answers.
  const [run, served, usage] = await Promise.all([
    deployment
      ? findCurrentIndexRun(projectId, deployment.id, {
          status: true,
          errorCode: true,
          indexedPages: true,
          indexedChunks: true,
          expectedPages: true,
          failedChunks: true,
          completedAt: true,
        })
      : null,
    servedIndexState(),
    readAnswerQuota(projectId),
  ]);
  const selection = selectionSchema.safeParse(project.config);
  return workspaceAiOverviewSchema.parse({
    capabilities: siteAiCapabilities(served),
    viewer: { canManage },
    status: siteAiStatus(project.config, projectId, connections, deployment, run, usage, canManage),
    selectedProvider: selection.success ? (selection.data.search?.aiProvider ?? 'instance') : 'instance',
    answersEnabled: selection.success && selection.data.search?.aiAnswers === true,
    encryptionConfigured: Boolean(env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY),
    instanceConfigured: Boolean(env.OPENROUTER_API_KEY),
    instanceAnswersEnabled: env.SEARCH_ANSWER_ENABLED,
    embeddingModel: env.SEARCH_EMBEDDING_MODEL,
    infrastructureConfigured: Boolean(getQdrantClient()),
    providers: aiProviderIdSchema.options.map((id) => {
      const connection = connections.find((item) => item.providerId === id);
      const config = aiConnectionConfigSchema.safeParse(connection?.config);
      return {
        id,
        configured: Boolean(connection),
        revision: connection?.revision ?? 0,
        // "Verified" must mean the runtime resolver will accept this connection:
        // healthy, built for the instance embedding model, and still decryptable
        // with the current keyring.
        verified:
          connection?.status === 'ACTIVE' &&
          connection.lastVerificationStatus === 'HEALTHY' &&
          config.success &&
          config.data.embeddingModel === env.SEARCH_EMBEDDING_MODEL &&
          credentialReadable(projectId, id, connection.credentialEncrypted),
        verifiedAt: connection?.lastVerifiedAt?.toISOString() ?? null,
        answerModel: config.success ? config.data.answerModel : null,
      };
    }),
    index: {
      published: Boolean(deployment),
      status: run?.status ?? null,
      errorCode: run?.errorCode ?? null,
      pages: run?.indexedPages ?? 0,
      chunks: run?.indexedChunks ?? 0,
    },
    openaiOAuth: {
      available: false,
      reason: 'registration_required' as const,
      documentation: 'https://developers.openai.com/siwc/token-sharing-open-source',
    },
  });
};

/** The last four characters of a key, so its owner can tell keys apart (D7). Short keys get no hint. */
const keyHint = (apiKey: string) => (apiKey.length >= 16 ? apiKey.slice(-4) : null);

export const getWorkspaceAiModels = async (ctx: Context<HonoEnv>, projectId: string, input: WorkspaceAiModelsBody) => {
  await authorize(ctx, projectId);
  const body = workspaceAiModelsBody.parse(input);
  const connection = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId: body.providerId } } });
  const apiKey = body.apiKey ?? (connection ? readCredential(projectId, body.providerId, connection.credentialEncrypted) : null);
  if (!apiKey) throw new AppError({ code: 'integration:credentials_invalid' });
  return { models: await discoverAiProviderModels(body.providerId, apiKey, savedAnswerModel(connection?.config)) };
};

export const saveWorkspaceAiConnection = async (ctx: Context<HonoEnv>, projectId: string, input: SaveWorkspaceAiConnectionBody) => {
  const { organizationId, actorId } = await authorize(ctx, projectId);
  const body = saveWorkspaceAiConnectionBody.parse(input);
  if (!env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY)
    throw new AppError({ code: 'integration:provider_unavailable', message: 'Credential encryption is not configured.' });
  const current = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId: body.providerId } } });
  if ((current?.revision ?? 0) !== body.expectedRevision) throw conflict('The provider connection changed. Reload before saving.');
  const apiKey = body.apiKey ?? (current ? readCredential(projectId, body.providerId, current.credentialEncrypted) : null);
  if (!apiKey) throw new AppError({ code: 'integration:credentials_invalid' });
  const models = await discoverAiProviderModels(body.providerId, apiKey, savedAnswerModel(current?.config));
  if (!models.some((model) => model.id === body.answerModel))
    throw new AppError({ code: 'validation:failed', message: 'Choose an available structured-answer model.' });
  const ciphertext = body.apiKey
    ? encryptIntegrationSecret(JSON.stringify({ kind: 'workspace-ai', projectId, providerId: body.providerId, apiKey }))
    : current?.credentialEncrypted;
  if (!ciphertext) throw new AppError({ code: 'integration:credentials_invalid' });
  try {
    await prisma.$transaction(async (tx) => {
      const data = {
        credentialEncrypted: ciphertext,
        ...(body.apiKey ? { credentialHint: keyHint(body.apiKey), credentialAddedAt: new Date() } : {}),
        config: { answerModel: body.answerModel, embeddingModel: env.SEARCH_EMBEDDING_MODEL },
        status: 'ACTIVE',
        lastVerificationStatus: 'HEALTHY',
        lastVerificationCode: null,
        lastVerifiedAt: new Date(),
      };
      let connectionId = current?.id;
      if (current) {
        const updated = await tx.projectIntegration.updateMany({
          where: { id: current.id, projectId, revision: body.expectedRevision },
          data: { ...data, revision: { increment: 1 } },
        });
        if (updated.count !== 1) throw conflict('The provider connection changed. Reload before saving.');
      } else {
        const created = await tx.projectIntegration.create({ data: { ...data, projectId, providerId: body.providerId, createdById: actorId } });
        connectionId = created.id;
      }
      await tx.integrationAuditEvent.create({
        data: {
          connectionId,
          projectId,
          providerId: body.providerId,
          organizationId,
          principalType: 'session',
          principalId: actorId,
          action: 'ai.connection.saved',
          result: 'success',
          metadata: { answerModel: body.answerModel },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw conflict('The provider connection changed. Reload before saving.');
    throw error;
  }
  invalidatePublishedSiteConfig(projectId);
  return getWorkspaceAi(ctx, projectId);
};

export const selectWorkspaceAi = async (ctx: Context<HonoEnv>, projectId: string, input: WorkspaceAiSelectionBody) => {
  const { project, organizationId, actorId } = await authorize(ctx, projectId);
  const body = workspaceAiSelectionBody.parse(input);
  const previous = selectionSchema.safeParse(project.config);
  const selectedProvider = body.providerId === 'disabled' && previous.success ? previous.data.search?.aiProvider : body.providerId;
  const auditProvider = selectedProvider === 'openai' ? 'openai' : 'openrouter';
  if (body.providerId !== 'disabled') {
    if (!getQdrantClient()) throw new AppError({ code: 'search:unavailable', message: 'Search infrastructure is not configured.' });
    if (body.providerId === 'instance') {
      if (!env.OPENROUTER_API_KEY || (body.answersEnabled && !env.SEARCH_ANSWER_ENABLED)) throw new AppError({ code: 'search:unavailable' });
    } else {
      const connection = await prisma.projectIntegration.findUnique({ where: { projectId_providerId: { projectId, providerId: body.providerId } } });
      if (
        !connection ||
        connection.revision !== body.expectedRevision ||
        connection.status !== 'ACTIVE' ||
        connection.lastVerificationStatus !== 'HEALTHY'
      )
        throw conflict('Verify this provider connection before enabling it.');
      const config = aiConnectionConfigSchema.safeParse(connection.config);
      if (!config.success || config.data.embeddingModel !== env.SEARCH_EMBEDDING_MODEL)
        throw conflict('Verify the current embedding model before enabling it.');
      readCredential(projectId, body.providerId, connection.credentialEncrypted);
    }
  }
  await prisma.$transaction(async (tx) => {
    await updateProjectConfigSection(tx, organizationId, projectId, 'search', (current) => ({
      ...z.record(z.string(), z.unknown()).parse(current ?? {}),
      aiProvider: body.providerId,
      aiAnswers: body.providerId !== 'disabled' && body.answersEnabled,
    }));
    await tx.integrationAuditEvent.create({
      data: {
        projectId,
        providerId: auditProvider,
        organizationId,
        principalType: 'session',
        principalId: actorId,
        action: 'ai.selection.updated',
        result: 'success',
        metadata: { selectedProvider: body.providerId, answersEnabled: body.providerId !== 'disabled' && body.answersEnabled },
      },
    });
  });
  invalidatePublishedSiteConfig(project.id);
  return getWorkspaceAi(ctx, projectId);
};
