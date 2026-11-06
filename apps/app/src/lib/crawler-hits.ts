import { randomUUID } from 'node:crypto';
import { classifyUserAgent } from '@nibleaf/clickhouse/classifiers';
import { serverEnv } from '@/env.server';
import { apiOrigin } from '@/services/api-origin';

interface CrawlerHit {
  identifier: string;
  eventId: string;
  occurredAt: string;
  path: string;
  userAgent: string;
  statusCode: number;
  contentType: string;
  durationMs: number;
}
const pending: CrawlerHit[] = [];
let timer: NodeJS.Timeout | undefined;
let flushing = false;
let resolving = 0;
const schedule = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, 1000);
  timer.unref();
};
const flush = async () => {
  if (flushing || !serverEnv.INTERNAL_API_SECRET) return;
  flushing = true;
  const batch = pending.splice(0, 100);
  try {
    const response = await fetch(`${apiOrigin()}/api/public/sites/_crawler-hits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nibleaf-internal': serverEnv.INTERNAL_API_SECRET },
      body: JSON.stringify({ hits: batch }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error('Crawler observation admission failed');
    await response.body?.cancel();
  } catch {
    pending.unshift(...batch.slice(0, Math.max(0, 2000 - pending.length)));
  } finally {
    flushing = false;
    if (pending.length) schedule();
  }
};

const collect = async (request: Request, result: Response, durationMs: number, resolveProject: (request: Request) => Promise<string | null>) => {
  if (resolving >= 64 || pending.length >= 2000) return;
  resolving += 1;
  try {
    const identifier = await resolveProject(request);
    if (!identifier || pending.length >= 2000) return;
    const path = new URL(request.url).pathname.replace(/^\/sites\/[^/]+\/?/u, '').replace(/^\//u, '');
    pending.push({
      identifier,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      path: path.slice(0, 512),
      userAgent: (request.headers.get('user-agent') ?? '').slice(0, 2048),
      statusCode: result.status,
      contentType: (result.headers.get('content-type') ?? '').slice(0, 120),
      durationMs,
    });
    schedule();
  } catch {
    /* Collection is optional; the original response remains intact. */
  } finally {
    resolving -= 1;
  }
};

let warnedMissingSecret = false;
/** The collector authenticates to the API with INTERNAL_API_SECRET; without it,
 * crawler visits to pages served by this server are not recorded. Say so once. */
const warnMissingSecret = () => {
  if (warnedMissingSecret) return;
  warnedMissingSecret = true;
  console.warn('[nibleaf] INTERNAL_API_SECRET is not set: AI crawler visits to published pages are not recorded in analytics.');
};

/** Observe the outer response once. Project resolution and collector I/O run
 * detached after the response. No dashboard root files or internal API probes. */
export const observeCrawlerResponse = (
  request: Request,
  response: Promise<Response> | Response,
  resolveProject: (request: Request) => Promise<string | null>,
): Promise<Response> => {
  const started = performance.now();
  const ua = request.headers.get('user-agent') ?? '';
  const url = new URL(request.url);
  const resultPromise = Promise.resolve(response);
  if (!serverEnv.INTERNAL_API_SECRET) {
    warnMissingSecret();
    return resultPromise;
  }
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || classifyUserAgent(ua).actorType !== 'bot') return resultPromise;
  return resultPromise.then((result) => {
    const contentType = result.headers.get('content-type') ?? '';
    if (/(?:text\/html|text\/markdown|xml|json|text\/plain)/iu.test(contentType))
      void collect(request, result, Math.min(3_600_000, Math.round(performance.now() - started)), resolveProject);
    return result;
  });
};
