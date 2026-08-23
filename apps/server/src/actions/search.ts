import { randomUUID } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { Prisma, prisma } from '@nibleaf/database';
import { getQdrantClient } from '@nibleaf/qdrant';
import { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import {
  SEARCH_MAX_RESULTS,
  type SearchIndexDiagnosticsQuery,
  searchConfigurationResultSchema,
  searchConfigurationSchema,
  searchIndexDiagnosticsQuery,
  searchIndexDiagnosticsResultSchema,
  type UpdateProjectSearchConfigurationBody,
  updateProjectSearchConfigurationBody,
} from '@nibleaf/validators';
import type { Context } from 'hono';
import { z } from 'zod';
import { env } from '@/env';
import { AppError, conflict, forbidden, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { createSearchDiagnosticsCursor, readSearchDiagnosticsCursor } from '@/lib/search-diagnostics-cursor';
import { updateProjectConfigSection } from './project-config';
import { assertProjectAccess } from './projects';
import { invalidatePublishedSiteConfig } from './sites';

const LOGICAL_INDEX_ID = 'nibleaf-hybrid-search';
const activeRunStatusSchema = z.enum(['PENDING', 'RUNNING']);
const facetValueSchema = z.string();
const metadataSchema = z.object({
  page_id: z.string(),
  ordinal: z.number().int().nonnegative(),
  language: z.string(),
  version_slug: z.string(),
});
const issueSchema = z
  .object({
    pageId: z.string(),
    ordinal: z.number().int().nonnegative(),
    language: z.string(),
    versionSlug: z.string(),
    status: z.enum(['stale', 'failed']),
    errorCode: z.string().max(80).optional(),
  })
  .strict();
const issueSampleSchema = z.array(issueSchema).max(25);
const projectConfigRecordSchema = z.record(z.string(), z.unknown()).catch({});
const searchRunProjectionSchema = z.object({
  id: z.string(),
  deploymentId: z.string().nullable(),
  status: z.enum(['PENDING', 'RUNNING', 'READY', 'FAILED', 'DISABLED']),
  expectedChunks: z.number(),
  indexedChunks: z.number(),
  indexedPages: z.number(),
  embeddedChunks: z.number(),
  reusedChunks: z.number(),
  unchangedChunks: z.number(),
  metadataUpdatedChunks: z.number(),
  deletedChunks: z.number(),
  staleChunks: z.number(),
  failedChunks: z.number(),
  errorCode: z.string().nullable(),
  issueSample: z.unknown(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});

type SearchScopeName = 'search:read' | 'search:write' | 'search:reindex';

const authorizeProjectSearch = async (ctx: Context<HonoEnv>, projectId: string, scope: SearchScopeName, mutation: boolean) => {
  const apiKey = ctx.get('apiKey');
  const scopedProject = ctx.get('project');
  if (apiKey) {
    if (apiKey.projectId !== projectId || scopedProject?.id !== projectId) throw notFound('project', { id: projectId });
    if (!apiKey.scopes.includes(scope)) throw forbidden('The credential does not grant this search capability.');
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: scopedProject.organizationId },
      select: { id: true, organizationId: true, config: true },
    });
    if (!project) throw notFound('project', { id: projectId });
    return { project, actorId: ctx.get('user')?.id ?? null };
  }

  const user = ctx.get('user');
  if (!user) throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  const access = await assertProjectAccess(user.id, projectId);
  if (mutation && !roleAtLeast(access.role, MemberRole.ADMIN)) throw forbidden('Administrator access is required.');
  return {
    project: { id: access.project.id, organizationId: access.organizationId, config: access.project.config },
    actorId: user.id,
  };
};

const resolveConfiguration = (config: unknown) => {
  const rawSearch = projectConfigRecordSchema.parse(config).search;
  const parsedSearch = searchConfigurationSchema.safeParse(rawSearch);
  const resolved = parsedSearch.success ? parsedSearch.data : searchConfigurationSchema.parse({});
  return searchConfigurationResultSchema.parse({
    configuration: { ...resolved, placeholder: resolved.placeholder ?? null },
    constraints: { maxResults: SEARCH_MAX_RESULTS },
  });
};

export const getProjectSearchConfiguration = async (ctx: Context<HonoEnv>, projectId: string) => {
  const { project } = await authorizeProjectSearch(ctx, projectId, 'search:read', false);
  return resolveConfiguration(project.config);
};

export const updateProjectSearchConfiguration = async (ctx: Context<HonoEnv>, projectId: string, input: UpdateProjectSearchConfigurationBody) => {
  const { project } = await authorizeProjectSearch(ctx, projectId, 'search:write', true);
  const resolvedInput = updateProjectSearchConfigurationBody.parse(input);
  const updated = await prisma.$transaction((tx) =>
    updateProjectConfigSection(tx, project.organizationId, projectId, 'search', (current) => {
      const parsedCurrent = searchConfigurationSchema.safeParse(current);
      const next = { ...(parsedCurrent.success ? parsedCurrent.data : searchConfigurationSchema.parse({})), ...resolvedInput };
      if (next.placeholder === null) delete next.placeholder;
      return searchConfigurationSchema.parse(next);
    }),
  );
  invalidatePublishedSiteConfig(projectId);
  return resolveConfiguration(updated.config);
};

const projectDeploymentFilter = (projectId: string, deploymentId: string) => ({
  must: [
    { key: 'project_id', match: { value: projectId } },
    { key: 'deployment_id', match: { value: deploymentId } },
  ],
});

const safeStringFacets = (facets: Array<{ value: string | number | boolean; count: number }>) =>
  facets.flatMap(({ value, count }) => {
    const parsed = facetValueSchema.safeParse(value);
    return parsed.success ? [{ value: parsed.data, count }] : [];
  });

const searchRunResultSchema = searchRunProjectionSchema.nullable().transform((run) =>
  run
    ? {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        counts: {
          expected: run.expectedChunks,
          indexed: run.indexedChunks,
          embedded: run.embeddedChunks,
          reused: run.reusedChunks,
          unchanged: run.unchangedChunks,
          metadataUpdated: run.metadataUpdatedChunks,
          deleted: run.deletedChunks,
          stale: run.staleChunks,
          failed: run.failedChunks,
        },
        errorCode: run.errorCode,
      }
    : null,
);

const getLatestSearchRun = (projectId: string, deploymentId: string) =>
  prisma.searchIndexRun.findFirst({
    where: { projectId, deploymentId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      deploymentId: true,
      status: true,
      expectedChunks: true,
      indexedChunks: true,
      indexedPages: true,
      embeddedChunks: true,
      reusedChunks: true,
      unchangedChunks: true,
      metadataUpdatedChunks: true,
      deletedChunks: true,
      staleChunks: true,
      failedChunks: true,
      errorCode: true,
      issueSample: true,
      startedAt: true,
      completedAt: true,
    },
  });

const unavailableDiagnostics = (reason: 'not_configured' | 'not_published' | 'provider_unavailable', latestRun: unknown) => {
  const resolvedLatestRun = searchRunProjectionSchema.nullable().parse(latestRun);
  return searchIndexDiagnosticsResultSchema.parse({
    availability: { configured: reason !== 'not_configured', reason },
    health: 'unavailable' as const,
    runtime: env.SEARCH_RUNTIME,
    index: {
      logicalId: LOGICAL_INDEX_ID,
      schemaVersion: env.QDRANT_COLLECTION_VERSION,
      revisionId: null,
      deploymentVersion: null,
      embeddingModel: env.SEARCH_EMBEDDING_MODEL,
      vectorSize: env.SEARCH_EMBEDDING_DIMENSIONS,
    },
    corpus: {
      chunks: null,
      pages: null,
      languages: [],
      versions: [],
      distributionTruncated: { languages: false, versions: false },
    },
    latestRun: searchRunResultSchema.parse(resolvedLatestRun),
    samples: { items: [], nextCursor: null, hasMore: false },
    issues: { staleCount: resolvedLatestRun?.staleChunks ?? 0, failedCount: resolvedLatestRun?.failedChunks ?? 0, items: [] },
  });
};

export const getProjectSearchIndexDiagnostics = async (ctx: Context<HonoEnv>, projectId: string, query: SearchIndexDiagnosticsQuery) => {
  await authorizeProjectSearch(ctx, projectId, 'search:read', false);
  const resolvedQuery = searchIndexDiagnosticsQuery.parse(query);
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });
  if (!deployment) return unavailableDiagnostics('not_published', null);
  const latestRun = await getLatestSearchRun(projectId, deployment.id);
  const qdrant = getQdrantClient();
  if (!qdrant) return unavailableDiagnostics('not_configured', latestRun);

  const filter = projectDeploymentFilter(projectId, deployment.id);
  const offset = readSearchDiagnosticsCursor(env.BETTER_AUTH_SECRET, resolvedQuery.cursor, projectId, deployment.id);
  try {
    const FACET_LIMIT = 101;
    const [requestedPage, chunks, languageFacets, versionFacets] = await Promise.all([
      qdrant.listIndexedMetadataPage(filter, { limit: resolvedQuery.limit, offset }),
      qdrant.count(filter),
      qdrant.facetCounts(filter, 'language', FACET_LIMIT),
      qdrant.facetCounts(filter, 'version_slug', FACET_LIMIT),
    ]);

    const items = requestedPage.points.flatMap((point) => {
      const metadata = metadataSchema.safeParse(point.payload);
      return metadata.success
        ? [
            {
              pointId: String(point.id),
              pageId: metadata.data.page_id,
              ordinal: metadata.data.ordinal,
              language: metadata.data.language,
              versionSlug: metadata.data.version_slug,
              status: 'indexed' as const,
            },
          ]
        : [];
    });
    const issues = issueSampleSchema.safeParse(latestRun?.issueSample);
    const health =
      latestRun && activeRunStatusSchema.safeParse(latestRun.status).success
        ? ('indexing' as const)
        : latestRun?.status === 'FAILED'
          ? ('failed' as const)
          : (latestRun?.staleChunks ?? 0) > 0
            ? ('stale' as const)
            : chunks === 0
              ? ('empty' as const)
              : ('ready' as const);
    return searchIndexDiagnosticsResultSchema.parse({
      availability: { configured: true, reason: null },
      health,
      runtime: env.SEARCH_RUNTIME,
      index: {
        logicalId: LOGICAL_INDEX_ID,
        schemaVersion: env.QDRANT_COLLECTION_VERSION,
        revisionId: deployment.id,
        deploymentVersion: deployment.version,
        embeddingModel: env.SEARCH_EMBEDDING_MODEL,
        vectorSize: env.SEARCH_EMBEDDING_DIMENSIONS,
      },
      corpus: {
        chunks,
        pages: latestRun?.status === 'READY' ? latestRun.indexedPages : null,
        languages: safeStringFacets(languageFacets.slice(0, FACET_LIMIT - 1))
          .map(({ value, count }) => ({ code: value, count }))
          .sort((a, b) => a.code.localeCompare(b.code)),
        versions: safeStringFacets(versionFacets.slice(0, FACET_LIMIT - 1))
          .map(({ value, count }) => ({ slug: value, count }))
          .sort((a, b) => a.slug.localeCompare(b.slug)),
        distributionTruncated: {
          languages: languageFacets.length === FACET_LIMIT,
          versions: versionFacets.length === FACET_LIMIT,
        },
      },
      latestRun: searchRunResultSchema.parse(latestRun),
      samples: {
        items,
        nextCursor:
          requestedPage.nextOffset === undefined
            ? null
            : createSearchDiagnosticsCursor(env.BETTER_AUTH_SECRET, projectId, deployment.id, requestedPage.nextOffset),
        hasMore: requestedPage.nextOffset !== undefined,
      },
      issues: {
        staleCount: latestRun?.staleChunks ?? 0,
        failedCount: latestRun?.failedChunks ?? 0,
        items: issues.success ? issues.data : [],
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    return unavailableDiagnostics('provider_unavailable', latestRun);
  }
};

export const createProjectSearchReindex = async (ctx: Context<HonoEnv>, projectId: string) => {
  const { actorId } = await authorizeProjectSearch(ctx, projectId, 'search:reindex', true);
  if (!(getQdrantClient() && env.OPENROUTER_API_KEY)) {
    throw new AppError({ code: 'search:unavailable', message: 'Search indexing is not configured.' });
  }
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });
  if (!deployment) throw notFound('deployment', { projectId });

  const findActiveRun = () =>
    prisma.searchIndexRun.findFirst({
      where: { projectId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deploymentId: true, jobId: true, status: true, createdAt: true },
    });
  const recoverPendingRun = async () => {
    const active = await findActiveRun();
    if (!active) return null;
    if (active.status === 'PENDING' && active.deploymentId === deployment.id && active.jobId) return active;
    throw conflict('Search indexing is already in progress.', { projectId });
  };
  const createRun = async () => {
    const runId = randomUUID();
    const jobId = `search-reindex-${runId}`;
    try {
      return await prisma.searchIndexRun.create({
        data: {
          id: runId,
          projectId,
          deploymentId: deployment.id,
          jobId,
          logicalIndexId: LOGICAL_INDEX_ID,
          schemaVersion: env.QDRANT_COLLECTION_VERSION,
          revisionId: deployment.id,
          embeddingModel: env.SEARCH_EMBEDDING_MODEL,
          vectorSize: env.SEARCH_EMBEDDING_DIMENSIONS,
          requestedById: actorId,
        },
        select: { id: true, deploymentId: true, jobId: true, status: true, createdAt: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await recoverPendingRun();
        if (raced) return raced;
        throw conflict('Search indexing is already in progress.', { projectId });
      }
      throw error;
    }
  };
  const run = (await recoverPendingRun()) ?? (await createRun());
  if (!run.jobId) throw conflict('Search indexing is already in progress.', { projectId });

  try {
    await createJob(
      QueueNames.SEARCH,
      { name: 'reindex-project', data: { projectId, deploymentId: deployment.id, runId: run.id } },
      { jobId: run.jobId },
    );
    await prisma.searchIndexRun.updateMany({ where: { id: run.id, status: 'PENDING', jobId: run.jobId }, data: { errorCode: null } });
  } catch (cause) {
    await prisma.searchIndexRun.updateMany({
      where: { id: run.id, status: 'PENDING', jobId: run.jobId },
      data: { errorCode: 'queue_unavailable' },
    });
    throw new AppError({ code: 'search:unavailable', message: 'Search indexing could not be queued.', cause });
  }

  return { id: run.id, status: run.status, createdAt: run.createdAt.toISOString(), deploymentVersion: deployment.version };
};
