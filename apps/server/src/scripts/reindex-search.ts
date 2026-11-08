/**
 * Queue a search rebuild of every published site into the configured Qdrant
 * collection. Run it after changing the embedding settings and before switching
 * the search alias (docs: self-hosting/search-ai, "Change the embedding model").
 *
 *   docker compose exec -T server pnpm --filter @nibleaf/server search:reindex-all
 *
 * From a source checkout: pnpm --filter @nibleaf/server with-env tsx src/scripts/reindex-search.ts
 */
import { queueSearchReindexForAllProjects } from '@/actions/search';

const { queued, skipped, failed } = await queueSearchReindexForAllProjects();
process.stdout.write(`${JSON.stringify({ queued: queued.length, skipped, failed }, null, 2)}\n`);
if (failed.length) process.stdout.write(`${failed.length} site(s) could not be queued. Fix the queue, then run this again.\n`);
process.stdout.write('The worker builds each queued site. Watch Site settings → Search for READY before switching the alias.\n');
// Skipped sites are intentional; a failed queue attempt is not. The queue
// connection would otherwise keep the process open.
process.exit(failed.length ? 1 : 0);
