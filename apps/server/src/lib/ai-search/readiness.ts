import { type Prisma, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { getQdrantClient } from '@nibleaf/qdrant';
import { env } from '@/env';

/**
 * Whether a site's published docs can answer readers: the one readiness check
 * the reader (runtime.ts), the AI answers overview and the Integrations cards
 * all use, so no screen can say "ready" while the reader refuses.
 */

const log = createLogger({ component: 'ai-search' });
const qdrant = getQdrantClient();

/** How long one reading of the alias's target is trusted. */
const INDEX_CHECK_MS = 30_000;
/** A failed reading is retried sooner, so a brief Qdrant outage pauses AI answers only briefly. */
const INDEX_RETRY_MS = 5000;
let indexCheck: { at: number; ttl: number; serving: Promise<boolean> } | undefined;
let lastServed: string | null | undefined;

/** Whether the read alias serves the collection this instance is configured
 * for (its alias, collection version and vector size). After an embedding
 * change the new collection is filled while the alias still serves the old
 * one; querying it with the new vectors would fail. Until the operator
 * reindexes and switches the alias, search keeps its keyword results and AI
 * answers pause instead. A failed reading also counts as not serving. */
export const configuredIndexServing = async (): Promise<boolean> => {
  const client = qdrant;
  if (!client) return false;
  const now = Date.now();
  if (!indexCheck || now - indexCheck.at >= indexCheck.ttl) {
    const check: NonNullable<typeof indexCheck> = { at: now, ttl: INDEX_CHECK_MS, serving: Promise.resolve(false) };
    check.serving = client.servedCollection().then(
      (served) => {
        if (served !== lastServed) {
          lastServed = served;
          const context = { alias: client.alias, served, configured: client.collection };
          if (served === client.collection) log.info(context, 'Hybrid search is serving the configured collection');
          else if (served === null) log.info(context, 'No hybrid search collection yet; the first index job creates it');
          else
            log.error(
              context,
              'Hybrid search and AI answers are paused: the search alias serves a collection built for other embedding settings. Reindex every site, then switch the alias to the configured collection (docs: self-hosting/search-ai, "Change the embedding model").',
            );
        }
        return served === client.collection;
      },
      (error: unknown) => {
        // Fail closed (keyword results, no AI answers), and read again soon.
        check.ttl = INDEX_RETRY_MS;
        log.warn(
          { alias: client.alias, configured: client.collection, error: error instanceof Error ? error.message : 'unknown error' },
          'Could not read the search alias; hybrid search and AI answers are paused until the next check',
        );
        return false;
      },
    );
    indexCheck = check;
  }
  return indexCheck.serving;
};

/**
 * Only runs built with the current embedding settings (collection schema
 * version, embedding model, vector size) indexed the collection being served;
 * a newer run for other settings (for example before a rollback) does not count.
 */
const currentIndexRunWhere = (projectId: string, deploymentId: string): Prisma.SearchIndexRunWhereInput => ({
  projectId,
  deploymentId,
  schemaVersion: env.QDRANT_COLLECTION_VERSION,
  embeddingModel: env.SEARCH_EMBEDDING_MODEL,
  vectorSize: env.SEARCH_EMBEDDING_DIMENSIONS,
});

/** The newest run that indexed the served collection for this deployment, if any. */
export const findCurrentIndexRun = <S extends Prisma.SearchIndexRunSelect>(projectId: string, deploymentId: string, select: S) =>
  prisma.searchIndexRun.findFirst({ where: currentIndexRunWhere(projectId, deploymentId), orderBy: { createdAt: 'desc' }, select });

/** A run that finished with content can ground answers. */
export const indexRunServesAnswers = (run: { status: string; indexedChunks: number } | null | undefined): boolean =>
  run?.status === 'READY' && run.indexedChunks > 0;
