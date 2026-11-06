import { timingSafeEqual } from 'node:crypto';
import { classifyCrawledResource, classifyUserAgent } from '@nibleaf/clickhouse';
import { createLogger } from '@nibleaf/logger';
import { z } from 'zod';
import { recordCrawlerRequest } from '@/actions/sites';

const log = createLogger({ module: 'crawler-hits' });
export const crawlerHitSchema = z
  .object({
    identifier: z.string().min(1).max(200),
    eventId: z.uuid(),
    occurredAt: z.iso.datetime({ offset: true }),
    path: z.string().max(512),
    userAgent: z.string().max(2048),
    statusCode: z.number().int().min(100).max(599),
    contentType: z.string().max(120),
    durationMs: z.number().int().min(0).max(3_600_000),
  })
  .strict();
export type CrawlerHit = z.infer<typeof crawlerHitSchema>;
export const crawlerBatchSchema = z.object({ hits: z.array(crawlerHitSchema).min(1).max(100) }).strict();

export const hasInternalAnalyticsProof = (header?: string): boolean => {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || !header) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const pending: CrawlerHit[] = [];
let timer: NodeJS.Timeout | undefined;
let flushing = false;
const flush = async () => {
  if (flushing) return;
  flushing = true;
  const batch = pending.splice(0, 100);
  try {
    await Promise.all(
      batch.map(async (hit) => {
        try {
          await recordCrawlerRequest(
            hit.identifier,
            {
              name: 'crawler_request',
              path: hit.path,
              statusCode: hit.statusCode,
              resource: hit.contentType.startsWith('text/markdown') ? 'markdown' : classifyCrawledResource(hit.path),
              contentType: hit.contentType,
              durationMs: hit.durationMs,
            },
            { userAgent: hit.userAgent, eventId: hit.eventId, occurredAt: hit.occurredAt },
          );
        } catch {
          log.warn({ eventId: hit.eventId }, 'crawler observation could not be queued');
        }
      }),
    );
  } finally {
    flushing = false;
    if (pending.length) schedule();
  }
};
const schedule = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, 250);
  timer.unref();
};

/** Synchronous bounded admission; no I/O is awaited by the response handler.
 * UA strings exist only in this transient buffer and are never persisted. */
export const enqueueCrawlerHit = (hit: CrawlerHit): boolean => {
  if (classifyUserAgent(hit.userAgent).actorType !== 'bot') return false;
  if (pending.length >= 2000) {
    log.warn('crawler observation buffer full; lowest-value event dropped');
    return false;
  }
  pending.push(hit);
  schedule();
  return true;
};
