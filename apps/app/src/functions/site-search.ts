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
  language: z.string().min(1).max(35).optional(),
  /** The reader's language: ranked first, while every language is searched. */
  prefer: z.string().min(1).max(35).optional(),
  version: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** Call the same-origin public API directly. Its reader grants, publication
 * lookup, rate limiting and analytics remain authoritative, without a second
 * app-server request and loopback fetch for every keystroke. */
export const searchSiteFn = async (input: { data: z.input<typeof searchSiteInput>; signal?: AbortSignal }) => {
  const data = searchSiteInput.parse({ ...input.data, ...getSiteSearchAnalytics(input.data.projectId) });
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
      { init: { signal: input.signal } },
    ),
    'search',
  );
  return result.hits.map((hit) => ({ ...hit, searchId: result.searchId }));
};
