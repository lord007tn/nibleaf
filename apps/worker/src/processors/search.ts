import type { ReindexProjectJobData } from '@nibleaf/bullmq/jobs/search';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { getQdrantClient, type QdrantFilter, type QdrantIndexedPoint, type QdrantPoint } from '@nibleaf/qdrant';
import { chunkSearchDocument, OpenRouterEmbeddingProvider, type SearchChunk, type SearchChunkSource, sparseVectorForChunk } from '@nibleaf/search';
import { extractHeadings, type SiteSnapshot } from '@nibleaf/shared/site';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { env } from '../env';

const log = createLogger({ processor: 'search' });
const BATCH_SIZE = 64;

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

/**
 * Incrementally index one immutable deployment. Current-deployment retries skip
 * unchanged points; metadata-only changes replace payloads; a new deployment
 * copies dense vectors from its nearest READY predecessor when the complete
 * embedding input hash matches. Only genuinely new/changed chunks are sent to
 * the embedding provider, and stale points are deleted after successful writes.
 */
export async function handleSearchJobs(job: Job<ReindexProjectJobData>) {
  const client = getQdrantClient();
  if (!client) {
    log.info({ projectId: job.data.projectId, job: job.name }, 'hybrid search infrastructure is not configured; job skipped');
    return { disabled: true };
  }
  await client.ensureHybridCollection();
  if (job.name === 'delete-project') {
    await client.deleteByFilterAllVersions(projectFilter(job.data.projectId));
    return { deleted: true };
  }
  if (job.name === 'delete-deployment') {
    if (!job.data.deploymentId) throw new Error('delete-deployment requires deploymentId');
    await client.deleteByFilterAllVersions(deploymentFilter(job.data.projectId, job.data.deploymentId));
    return { deleted: true };
  }
  if (!env.OPENROUTER_API_KEY) {
    log.info({ projectId: job.data.projectId, job: job.name }, 'hybrid search embedding provider is not configured; indexing skipped');
    return { disabled: true };
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
  const [project, previousDeployment] = await Promise.all([
    prisma.project.findUnique({ where: { id: job.data.projectId }, select: { accessMode: true } }),
    prisma.deployment.findFirst({
      where: { projectId: job.data.projectId, status: 'READY', id: { not: deployment.id }, version: { lt: deployment.version } },
      orderBy: { version: 'desc' },
      select: { id: true },
    }),
  ]);
  if (!project) throw new Error(`project ${job.data.projectId} was not found.`);
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
  if (provider.dimensions !== client.vectorSize) throw new Error('Qdrant vector size and embedding dimensions must match.');

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
    const batch = toEmbed.slice(offset, offset + BATCH_SIZE);
    const result = await provider.embed(batch.map(({ chunk }) => embeddingText(chunk)));
    const points = batch.map((item, index) => pointFromChunk(item.chunk, result.vectors[index] ?? [], item.payload));
    await client.upsert(points);
    embedded += points.length;
    await job.updateProgress(desired.length === 0 ? 90 : Math.min(90, Math.round(((embedded + reused.length) / desired.length) * 90)));
  }
  for (let offset = 0; offset < reused.length; offset += BATCH_SIZE) {
    await client.upsert(reused.slice(offset, offset + BATCH_SIZE));
  }
  for (let offset = 0; offset < metadataUpdates.length; offset += BATCH_SIZE) {
    await Promise.all(
      metadataUpdates.slice(offset, offset + BATCH_SIZE).map((update) => client.replacePayload(update.id, update.payload, currentFilter)),
    );
  }

  const staleIds = currentPoints.flatMap((point) => (desiredIds.has(String(point.id)) ? [] : [point.id]));
  await client.deletePoints(staleIds, currentFilter);
  await job.updateProgress(100);
  const result = {
    indexed: embedded + reused.length,
    embedded,
    reused: reused.length,
    metadataUpdated: metadataUpdates.length,
    unchanged,
    deleted: staleIds.length,
  };
  log.info({ projectId: job.data.projectId, deploymentId: deployment.id, ...result }, 'hybrid search deployment diff applied');
  return result;
}
