import type { ReindexProjectJobData } from '@nibleaf/bullmq/jobs/search';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { getQdrantClient, type QdrantFilter, type QdrantPoint } from '@nibleaf/qdrant';
import {
  chunkSearchDocument,
  OpenAICompatibleEmbeddingProvider,
  type SearchChunk,
  type SearchChunkSource,
  sparseVectorForChunk,
} from '@nibleaf/search';
import { extractHeadings, type SiteSnapshot } from '@nibleaf/shared/site';
import type { Job } from 'bullmq';
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

const pointFromChunk = (
  chunk: SearchChunk,
  dense: number[],
  meta: { projectId: string; deploymentId: string; versionSlug: string; visibility: 'public' | 'private' },
): QdrantPoint => ({
  id: chunk.id,
  vector: { dense, bm25: sparseVectorForChunk(chunk) },
  payload: {
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
  },
});

/** Idempotently index an immutable deployment. A collection schema/chunker
 * change requires a new QDRANT_COLLECTION_VERSION and alias cutover; retries of
 * the same schema upsert the same deterministic point ids. */
export async function handleSearchJobs(job: Job<ReindexProjectJobData>): Promise<{ indexed?: number; deleted?: boolean; disabled?: boolean }> {
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
  const apiKey = env.SEARCH_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    log.info({ projectId: job.data.projectId, job: job.name }, 'hybrid search embedding provider is not configured; indexing skipped');
    return { disabled: true };
  }
  const deployment = job.data.deploymentId
    ? await prisma.deployment.findFirst({
        where: { id: job.data.deploymentId, projectId: job.data.projectId, status: 'READY' },
        select: { id: true, snapshot: true },
      })
    : await prisma.deployment.findFirst({
        where: { projectId: job.data.projectId, status: 'READY' },
        orderBy: { version: 'desc' },
        select: { id: true, snapshot: true },
      });
  if (!deployment?.snapshot) throw new Error(`READY deployment for project ${job.data.projectId} was not found.`);
  const project = await prisma.project.findUnique({ where: { id: job.data.projectId }, select: { accessMode: true } });
  if (!project) throw new Error(`project ${job.data.projectId} was not found.`);
  const snapshot = deployment.snapshot as unknown as SiteSnapshot;
  const provider = new OpenAICompatibleEmbeddingProvider({
    apiKey,
    baseUrl: env.SEARCH_EMBEDDING_BASE_URL,
    model: env.SEARCH_EMBEDDING_MODEL,
    dimensions: env.SEARCH_EMBEDDING_DIMENSIONS,
    timeoutMs: env.SEARCH_EMBEDDING_TIMEOUT_MS,
    maxBatchSize: BATCH_SIZE,
  });
  if (provider.dimensions !== client.vectorSize) throw new Error('Qdrant vector size and embedding dimensions must match.');
  const versionChunks = snapshot.project.versions.map((version) => ({
    version,
    chunks: snapshot.pages
      .filter((page) => page.versionId === version.id && page.kind === 'PAGE' && !page.hidden && !page.config?.seo?.noindex)
      .flatMap((page) =>
        chunkSearchDocument({ projectId: job.data.projectId, deploymentId: deployment.id, versionSlug: version.slug }, sourceFromPage(page)),
      ),
  }));
  const total = versionChunks.reduce((count, item) => count + item.chunks.length, 0);
  let indexed = 0;
  for (const { version, chunks } of versionChunks) {
    for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + BATCH_SIZE);
      const embedded = await provider.embed(batch.map(embeddingText));
      const points = batch.map((chunk, index) =>
        pointFromChunk(chunk, embedded.vectors[index] ?? [], {
          projectId: job.data.projectId,
          deploymentId: deployment.id,
          versionSlug: version.slug,
          visibility: project.accessMode === 'PUBLIC' ? 'public' : 'private',
        }),
      );
      await client.upsert(points);
      indexed += points.length;
      await job.updateProgress(total === 0 ? 100 : Math.min(99, Math.round((indexed / total) * 100)));
    }
  }
  await job.updateProgress(100);
  log.info({ projectId: job.data.projectId, deploymentId: deployment.id, indexed }, 'hybrid search deployment indexed');
  return { indexed };
}
