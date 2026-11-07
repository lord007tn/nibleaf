import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { getData } from '@/hooks/api/client-helpers';
import type { SiteSearchHit } from '@/hooks/api/types';
import { getSiteSearchAnalytics } from '@/providers/site-analytics-provider';
import { api } from '@/services/api';

const searchSiteInput = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().max(128).optional(),
  consentState: z.enum(['denied', 'granted', 'not_required', 'unknown']).default('unknown'),
  query: z.string().trim().min(1).max(300),
  language: z.string().min(1).optional(),
  /** The reader's language: ranked first, while every language is searched. */
  prefer: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** Public reader search stays behind the Hono endpoint so publication lookup,
 * reader grants, rate limiting, analytics, and request cancellation all share
 * the same server context. The app server's authenticated fetch forwarding
 * preserves the visitor's cookie and authorization header. */
const performSearchSiteFn = createServerFn({ method: 'GET' })
  .validator(searchSiteInput)
  .handler(async ({ data }) => {
    const result = await getData<{ hits: SiteSearchHit[]; searchId: string }>(
      await api.public.sites[':id'].search.$get(
        {
          param: { id: data.projectId },
          query: {
            q: data.query,
            consentState: data.consentState,
            ...(data.sessionId ? { sessionId: data.sessionId } : {}),
            ...(data.limit ? { limit: String(data.limit) } : {}),
            ...(data.language ? { lang: data.language } : {}),
            ...(data.prefer ? { prefer: data.prefer } : {}),
            ...(data.version ? { version: data.version } : {}),
          },
        },
        // When the reader's browser cancels this request (they typed past it),
        // stop the API search too.
        { init: { signal: getRequest().signal } },
      ),
      'search',
    );
    return result.hits.map((hit) => ({ ...hit, searchId: result.searchId }));
  });

/** The query's abort signal cancels the request once the reader has typed past it. */
export const searchSiteFn = (input: { data: z.input<typeof searchSiteInput>; signal?: AbortSignal }) =>
  performSearchSiteFn({ data: { ...input.data, ...getSiteSearchAnalytics(input.data.projectId) }, signal: input.signal });
