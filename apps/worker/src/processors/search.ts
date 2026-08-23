import { randomUUID } from 'node:crypto';
import type { ReindexProjectJobData } from '@nibleaf/bullmq/jobs/search';
import { Prisma, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { getQdrantClient, type QdrantFilter, type QdrantIndexedPoint, type QdrantPoint } from '@nibleaf/qdrant';
import { chunkSearchDocument, OpenRouterEmbeddingProvider, type SearchChunk, type SearchChunkSource, sparseVectorForChunk } from '@nibleaf/search';
import { extractHeadings, type SiteSnapshot } from '@nibleaf/shared/site';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { env } from '../env';

const log = createLogger({ processor: 'search' });
const BATCH_SIZE = 64;
const LOGICAL_INDEX_ID = 'nibleaf-hybrid-search';
// A claim always outlives the longest configured single provider request, with
// a full minute of scheduling/network margin. Batches renew before and after
// those calls so a slow-but-live worker cannot be reclaimed concurrently.
const RUN_CLAIM_TTL_MS = Math.max(env.SEARCH_EMBEDDING_TIMEOUT_MS, env.QDRANT_TIMEOUT_MS) + 60_000;
const RUN_CLAIM_ATTEMPTS = 3;

const projectFilter = (projectId: string): QdrantFilter => ({ must: [{ key: 'project_id', match: { value: projectId } }] });
const deploymentFilter = (projectId: string, deploymentId: string): QdrantFilter => ({
  must: [
    { key: 'project_id', match: { value: projectId } },
    { key: 'deployment_id', match: { value: deploymentId } },
  ],
});

const embeddingText = (chunk: SearchChunk): string =>
  [`# ${chunk.title}`, chunk.headingPath.length > 0 ? chunk.headingPath.join(' > ') : '', chunk.description, chunk.content]
    .filter(Boolean)
    .join('\n\n');

const sourceFromPage = (page: SiteSnapshot['pages'][number]): SearchChunkSource => ({
  id: page.id,
  title: page.title,
  path: page.path,
  description: page.description ?? '',
  headings: extractHeadings(page.content).map((heading) => heading.text),
  content: page.content,
  icon: page.icon ?? undefined,
  language: page.languageCode,
  visible: page.kind === 'PAGE' && !page.hidden && !page.config?.seo?.noindex,
});

const payloadFromChunk = (
  chunk: SearchChunk,
  meta: { projectId: string; deploymentId: string; versionSlug: string; visibility: 'public' | 'private' },
) => ({
  project_id: meta.projectId,
  deployment_id: meta.deploymentId,
  version_slug: meta.versionSlug,
  language: chunk.language,
  visibility: meta.visibility,
  visible: chunk.visible,
  page_id: chunk.pageId,
  ordinal: chunk.ordinal,
  title: chunk.title,
  path: chunk.path,
  description: chunk.description,
  heading: chunk.heading,
  heading_path: chunk.headingPath,
  content: chunk.content,
  content_hash: chunk.contentHash,
  direction: chunk.direction,
  ...(chunk.icon ? { icon: chunk.icon } : {}),
});

const pointFromChunk = (chunk: SearchChunk, dense: number[], payload: Record<string, unknown>): QdrantPoint => ({
  id: chunk.id,
  vector: { dense, bm25: sparseVectorForChunk(chunk) },
  payload,
});

const payloadSignature = (payload: Record<string, unknown>) =>
  JSON.stringify([
    payload.project_id,
    payload.deployment_id,
    payload.version_slug,
    payload.language,
    payload.visibility,
    payload.visible,
    payload.page_id,
    payload.ordinal,
    payload.title,
    payload.path,
    payload.description,
    payload.heading,
    payload.heading_path,
    payload.content,
    payload.content_hash,
    payload.direction,
    payload.icon ?? null,
  ]);

const reusablePayloadSchema = z.object({
  version_slug: z.string(),
  language: z.string(),
  page_id: z.string(),
  ordinal: z.number().int().nonnegative(),
  content_hash: z.string(),
});

const reuseKey = (input: { versionSlug: string; language: string; pageId: string; ordinal: number; contentHash: string }) =>
  JSON.stringify([input.versionSlug, input.language, input.pageId, input.ordinal, input.contentHash]);

const reuseKeyFromPoint = (point: QdrantIndexedPoint) => {
  const parsed = reusablePayloadSchema.safeParse(point.payload);
  if (!parsed.success || !point.vector) return null;
  return reuseKey({
    versionSlug: parsed.data.version_slug,
    language: parsed.data.language,
    pageId: parsed.data.page_id,
    ordinal: parsed.data.ordinal,
    contentHash: parsed.data.content_hash,
  });
};

const issueFromChunk = (chunk: SearchChunk, versionSlug: string, status: 'stale' | 'failed', errorCode?: string) => ({
  pageId: chunk.pageId,
  ordinal: chunk.ordinal,
  language: chunk.language,
  versionSlug,
  status,
  ...(errorCode ? { errorCode } : {}),
});

interface SearchIndexIssue {
  pageId: string;
  ordinal: number;
  language: string;
  versionSlug: string;
  status: 'stale' | 'failed';
  errorCode?: string;
}

const staleIssueSchema = z.object({
  page_id: z.string(),
  ordinal: z.number().int().nonnegative(),
  language: z.string(),
  version_slug: z.string(),
});

class SearchIndexFailure extends Error {
  constructor(
    readonly errorCode: string,
    readonly failedChunks: number,
    readonly issueSample: SearchIndexIssue[],
    cause?: unknown,
  ) {
    super(errorCode, { cause });
  }
}

class SearchRunBusy extends Error {}

const claimRun = async (data: ReindexProjectJobData, deployment: { id: string }, jobId: string) => {
  for (let attempt = 0; attempt < RUN_CLAIM_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const staleBefore = new Date(now.getTime() - RUN_CLAIM_TTL_MS);
        const claimExpiresAt = new Date(now.getTime() + RUN_CLAIM_TTL_MS);
        let run = await tx.searchIndexRun.findFirst({
          where: data.runId
            ? { id: data.runId, projectId: data.projectId, deploymentId: deployment.id }
            : { jobId, projectId: data.projectId, deploymentId: deployment.id },
          select: {
            id: true,
            jobId: true,
            status: true,
            claimToken: true,
            claimExpiresAt: true,
            startedAt: true,
            updatedAt: true,
            indexedChunks: true,
            embeddedChunks: true,
            reusedChunks: true,
            unchangedChunks: true,
            metadataUpdatedChunks: true,
            deletedChunks: true,
          },
        });

        if (!run) {
          const active = await tx.searchIndexRun.findFirst({
            where: { projectId: data.projectId, status: { in: ['PENDING', 'RUNNING'] } },
            select: { id: true, claimExpiresAt: true, updatedAt: true },
          });
          if (active) {
            const abandoned = active.claimExpiresAt ? active.claimExpiresAt <= now : active.updatedAt <= staleBefore;
            if (!abandoned) throw new SearchRunBusy('Search indexing is already active for this project.');
            const failed = await tx.searchIndexRun.updateMany({
              where: { id: active.id, updatedAt: active.updatedAt, status: { in: ['PENDING', 'RUNNING'] } },
              data: {
                status: 'FAILED',
                errorCode: 'run_claim_expired',
                claimToken: null,
                claimExpiresAt: null,
                completedAt: now,
              },
            });
            if (failed.count !== 1) throw new SearchRunBusy('Search index run ownership changed.');
          }
          run = await tx.searchIndexRun.create({
            data: {
              projectId: data.projectId,
              deploymentId: deployment.id,
              jobId,
              logicalIndexId: LOGICAL_INDEX_ID,
              schemaVersion: env.QDRANT_COLLECTION_VERSION,
              revisionId: deployment.id,
              embeddingModel: env.SEARCH_EMBEDDING_MODEL,
              vectorSize: env.SEARCH_EMBEDDING_DIMENSIONS,
            },
            select: {
              id: true,
              jobId: true,
              status: true,
              claimToken: true,
              claimExpiresAt: true,
              startedAt: true,
              updatedAt: true,
              indexedChunks: true,
              embeddedChunks: true,
              reusedChunks: true,
              unchangedChunks: true,
              metadataUpdatedChunks: true,
              deletedChunks: true,
            },
          });
        }

        if (run.jobId && run.jobId !== jobId) throw new SearchRunBusy('Search index run belongs to a different durable job.');
        if (run.status === 'READY' || run.status === 'DISABLED') return { kind: 'terminal' as const, run };
        const expired = run.claimExpiresAt ? run.claimExpiresAt <= now : run.updatedAt <= staleBefore;
        if (run.status === 'RUNNING' && run.claimToken && !expired) throw new SearchRunBusy('Search index run is actively claimed.');

        const claimToken = randomUUID();
        const claimed = await tx.searchIndexRun.updateMany({
          where: { id: run.id, updatedAt: run.updatedAt, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
          data: {
            jobId,
            status: 'RUNNING',
            claimToken,
            claimExpiresAt,
            attempt: { increment: 1 },
            startedAt: run.startedAt ?? now,
            completedAt: null,
            errorCode: null,
          },
        });
        if (claimed.count !== 1) throw new SearchRunBusy('Search index run ownership changed.');
        return { kind: 'claimed' as const, id: run.id, claimToken };
      });
    } catch (error) {
      const raced = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (raced && attempt < RUN_CLAIM_ATTEMPTS - 1) continue;
      throw error;
    }
  }
  throw new SearchRunBusy('Search index run could not be claimed.');
};

const renewRunClaim = async (run: { id: string; claimToken: string }) => {
  const renewed = await prisma.searchIndexRun.updateMany({
    where: { id: run.id, status: 'RUNNING', claimToken: run.claimToken },
    data: { claimExpiresAt: new Date(Date.now() + RUN_CLAIM_TTL_MS) },
  });
  if (renewed.count !== 1) throw new SearchIndexFailure('run_claim_lost', 0, []);
};

/**
 * Incrementally index one immutable deployment. Current-deployment retries skip
 * unchanged points; metadata-only changes replace payloads; a new deployment
 * copies dense vectors from its nearest READY predecessor when the complete
 * embedding input hash matches. Only genuinely new/changed chunks are sent to
 * the embedding provider, and stale points are deleted after successful writes.
 */
export async function handleSearchJobs(job: Job<ReindexProjectJobData>) {
  const client = getQdrantClient();
  if (job.name === 'delete-project') {
    if (!client) return { disabled: true };
    await client.deleteByFilterAllVersions(projectFilter(job.data.projectId));
    return { deleted: true };
  }
  if (job.name === 'delete-deployment') {
    if (!job.data.deploymentId) throw new Error('delete-deployment requires deploymentId');
    if (!client) return { disabled: true };
    await client.deleteByFilterAllVersions(deploymentFilter(job.data.projectId, job.data.deploymentId));
    return { deleted: true };
  }
  const deployment = job.data.deploymentId
    ? await prisma.deployment.findFirst({
        where: { id: job.data.deploymentId, projectId: job.data.projectId, status: 'READY' },
        select: { id: true, version: true, snapshot: true },
      })
    : await prisma.deployment.findFirst({
        where: { projectId: job.data.projectId, status: 'READY' },
        orderBy: { version: 'desc' },
        select: { id: true, version: true, snapshot: true },
      });
  if (!deployment?.snapshot) throw new Error(`READY deployment for project ${job.data.projectId} was not found.`);
  const durableJobId = String(job.id ?? `${job.name}:${job.data.projectId}:${deployment.id}`);
  const claim = await claimRun(job.data, deployment, durableJobId);
  if (claim.kind === 'terminal') {
    if (claim.run.status === 'DISABLED') return { status: 'DISABLED' as const, disabled: true };
    return {
      status: 'READY' as const,
      indexed: claim.run.indexedChunks,
      embedded: claim.run.embeddedChunks,
      reused: claim.run.reusedChunks,
      metadataUpdated: claim.run.metadataUpdatedChunks,
      unchanged: claim.run.unchangedChunks,
      deleted: claim.run.deletedChunks,
    };
  }
  const run = claim;

  if (!(client && env.OPENROUTER_API_KEY)) {
    const errorCode = client ? 'embedding_provider_not_configured' : 'index_provider_not_configured';
    const disabled = await prisma.searchIndexRun.updateMany({
      where: { id: run.id, claimToken: run.claimToken },
      data: { status: 'DISABLED', errorCode, claimToken: null, claimExpiresAt: null, completedAt: new Date() },
    });
    if (disabled.count !== 1) throw new SearchIndexFailure('run_claim_lost', 0, []);
    log.info({ projectId: job.data.projectId, job: job.name, errorCode }, 'hybrid search indexing is disabled');
    return { disabled: true };
  }

  let expectedChunks = 0;
  let expectedPages = 0;
  let failedChunks = 0;
  let issueSample: SearchIndexIssue[] = [];
  try {
    await renewRunClaim(run);
    await client.ensureHybridCollection();
    const [project, previousDeployment] = await Promise.all([
      prisma.project.findUnique({ where: { id: job.data.projectId }, select: { accessMode: true } }),
      prisma.deployment.findFirst({
        where: { projectId: job.data.projectId, status: 'READY', id: { not: deployment.id }, version: { lt: deployment.version } },
        orderBy: { version: 'desc' },
        select: { id: true },
      }),
    ]);
    if (!project) throw new SearchIndexFailure('project_not_found', 0, []);
    const snapshot = deployment.snapshot as unknown as SiteSnapshot;
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.SEARCH_EMBEDDING_MODEL,
      dimensions: env.SEARCH_EMBEDDING_DIMENSIONS,
      timeoutMs: env.SEARCH_EMBEDDING_TIMEOUT_MS,
      maxBatchSize: BATCH_SIZE,
      siteUrl: env.APP_URL,
      title: 'Nibleaf',
    });
    if (provider.dimensions !== client.vectorSize) throw new SearchIndexFailure('vector_size_mismatch', 0, []);

    const visibility = project.accessMode === 'PUBLIC' ? 'public' : 'private';
    const desired = snapshot.project.versions.flatMap((version) =>
      snapshot.pages
        .filter((page) => page.versionId === version.id && page.kind === 'PAGE' && !page.hidden && !page.config?.seo?.noindex)
        .flatMap((page) =>
          chunkSearchDocument({ projectId: job.data.projectId, deploymentId: deployment.id, versionSlug: version.slug }, sourceFromPage(page)),
        )
        .map((chunk) => ({
          chunk,
          versionSlug: version.slug,
          payload: payloadFromChunk(chunk, {
            projectId: job.data.projectId,
            deploymentId: deployment.id,
            versionSlug: version.slug,
            visibility,
          }),
        })),
    );
    expectedChunks = desired.length;
    expectedPages = new Set(desired.map(({ chunk }) => chunk.pageId)).size;
    await renewRunClaim(run);
    await prisma.searchIndexRun.updateMany({ where: { id: run.id, claimToken: run.claimToken }, data: { expectedChunks, expectedPages } });

    const currentFilter = deploymentFilter(job.data.projectId, deployment.id);
    const [currentPoints, previousPoints] = await Promise.all([
      client.listIndexedPoints(currentFilter),
      previousDeployment ? client.listIndexedPoints(deploymentFilter(job.data.projectId, previousDeployment.id), true) : Promise.resolve([]),
    ]);
    const currentById = new Map(currentPoints.map((point) => [String(point.id), point]));
    const reusableByKey = new Map(
      previousPoints.flatMap((point) => {
        const key = reuseKeyFromPoint(point);
        return key && point.vector ? [[key, point.vector.dense] as const] : [];
      }),
    );
    const desiredIds = new Set(desired.map(({ chunk }) => chunk.id));
    const toEmbed = desired.slice(0, 0);
    const reused = [] as QdrantPoint[];
    const metadataUpdates = [] as Array<{ id: string; payload: Record<string, unknown> }>;
    let unchanged = 0;

    for (const item of desired) {
      const current = currentById.get(item.chunk.id);
      if (current) {
        if (payloadSignature(current.payload) === payloadSignature(item.payload)) unchanged += 1;
        else metadataUpdates.push({ id: item.chunk.id, payload: item.payload });
        continue;
      }
      const dense = reusableByKey.get(
        reuseKey({
          versionSlug: item.versionSlug,
          language: item.chunk.language,
          pageId: item.chunk.pageId,
          ordinal: item.chunk.ordinal,
          contentHash: item.chunk.contentHash,
        }),
      );
      if (dense?.length === client.vectorSize) reused.push(pointFromChunk(item.chunk, dense, item.payload));
      else toEmbed.push(item);
    }

    let embedded = 0;
    for (let offset = 0; offset < toEmbed.length; offset += BATCH_SIZE) {
      await renewRunClaim(run);
      const batch = toEmbed.slice(offset, offset + BATCH_SIZE);
      const embedBatch = async () => {
        try {
          return await provider.embed(batch.map(({ chunk }) => embeddingText(chunk)));
        } catch (cause) {
          failedChunks = batch.length;
          issueSample = batch.slice(0, 25).map(({ chunk, versionSlug }) => issueFromChunk(chunk, versionSlug, 'failed', 'embedding_failed'));
          throw new SearchIndexFailure('embedding_failed', failedChunks, issueSample, cause);
        }
      };
      const embeddedBatch = await embedBatch();
      const points = batch.map((item, index) => pointFromChunk(item.chunk, embeddedBatch.vectors[index] ?? [], item.payload));
      await client.upsert(points);
      await renewRunClaim(run);
      embedded += points.length;
      await job.updateProgress(desired.length === 0 ? 90 : Math.min(90, Math.round(((embedded + reused.length) / desired.length) * 90)));
    }
    for (let offset = 0; offset < reused.length; offset += BATCH_SIZE) {
      await renewRunClaim(run);
      await client.upsert(reused.slice(offset, offset + BATCH_SIZE));
    }
    for (let offset = 0; offset < metadataUpdates.length; offset += BATCH_SIZE) {
      await renewRunClaim(run);
      await Promise.all(
        metadataUpdates.slice(offset, offset + BATCH_SIZE).map((update) => client.replacePayload(update.id, update.payload, currentFilter)),
      );
    }

    const stalePoints = currentPoints.filter((point) => !desiredIds.has(String(point.id)));
    const staleIds = stalePoints.map((point) => point.id);
    const staleSample = stalePoints.flatMap((point) => {
      const metadata = staleIssueSchema.safeParse(point.payload);
      return metadata.success
        ? [
            {
              pageId: metadata.data.page_id,
              ordinal: metadata.data.ordinal,
              language: metadata.data.language,
              versionSlug: metadata.data.version_slug,
              status: 'stale' as const,
            },
          ]
        : [];
    });
    try {
      await renewRunClaim(run);
      await client.deletePoints(staleIds, currentFilter);
    } catch (cause) {
      issueSample = staleSample.slice(0, 25);
      throw new SearchIndexFailure('stale_delete_failed', 0, issueSample, cause);
    }
    await job.updateProgress(100);
    const result = {
      indexed: embedded + reused.length,
      embedded,
      reused: reused.length,
      metadataUpdated: metadataUpdates.length,
      unchanged,
      deleted: staleIds.length,
    };
    const completed = await prisma.searchIndexRun.updateMany({
      where: { id: run.id, claimToken: run.claimToken, status: 'RUNNING' },
      data: {
        status: 'READY',
        indexedChunks: expectedChunks,
        indexedPages: expectedPages,
        embeddedChunks: embedded,
        reusedChunks: reused.length,
        unchangedChunks: unchanged,
        metadataUpdatedChunks: metadataUpdates.length,
        deletedChunks: staleIds.length,
        staleChunks: 0,
        failedChunks: 0,
        errorCode: null,
        issueSample: Prisma.JsonNull,
        claimToken: null,
        claimExpiresAt: null,
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) throw new SearchIndexFailure('run_claim_lost', 0, []);
    log.info({ projectId: job.data.projectId, deploymentId: deployment.id, runId: run.id, ...result }, 'hybrid search deployment diff applied');
    return result;
  } catch (error) {
    const failure = error instanceof SearchIndexFailure ? error : new SearchIndexFailure('index_provider_failed', failedChunks, issueSample, error);
    await prisma.searchIndexRun.updateMany({
      where: { id: run.id, claimToken: run.claimToken },
      data: {
        status: 'FAILED',
        expectedChunks,
        expectedPages,
        failedChunks: failure.failedChunks,
        staleChunks: failure.issueSample.filter((issue) => issue.status === 'stale').length,
        errorCode: failure.errorCode,
        issueSample: failure.issueSample.map((issue) => ({ ...issue })),
        claimToken: null,
        claimExpiresAt: null,
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
