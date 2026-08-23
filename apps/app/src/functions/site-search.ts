import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getData } from '@/hooks/api/client-helpers';
import type { SearchAnswer } from '@/hooks/api/types';
import { api } from '@/services/api';

const searchSiteInput = z.object({
  projectId: z.string().min(1),
  query: z.string().trim().min(1).max(300),
  language: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const answerSiteInput = searchSiteInput.omit({ limit: true }).extend({ query: z.string().trim().min(2).max(300) });

/** Public reader search stays behind the Hono endpoint so publication lookup,
 * reader grants, rate limiting, analytics, and request cancellation all share
 * the same server context. The app server's authenticated fetch forwarding
 * preserves the visitor's cookie and authorization header. */
export const searchSiteFn = createServerFn({ method: 'GET' })
  .validator(searchSiteInput)
  .handler(async ({ data }) => {
    const result = await getData(
      await api.public.sites[':id'].search.$get({
        param: { id: data.projectId },
        query: {
          q: data.query,
          ...(data.limit ? { limit: String(data.limit) } : {}),
          ...(data.language ? { lang: data.language } : {}),
          ...(data.version ? { version: data.version } : {}),
        },
      }),
      'search',
    );
    return result.hits;
  });

export const answerSiteFn = createServerFn({ method: 'POST' })
  .validator(answerSiteInput)
  .handler(async ({ data }) =>
    getData<SearchAnswer>(
      await api.public.sites[':id'].answer.$post({
        param: { id: data.projectId },
        json: {
          q: data.query,
          ...(data.language ? { lang: data.language } : {}),
          ...(data.version ? { version: data.version } : {}),
        },
      }),
      'answer',
    ),
  );
