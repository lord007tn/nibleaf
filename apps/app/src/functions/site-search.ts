import { getData } from '@/hooks/api/client-helpers';
import type { SiteSearchHit } from '@/hooks/api/types';
import { getSiteSearchAnalytics } from '@/providers/site-analytics-provider';
import { api } from '@/services/api';
import { parseSearchSiteInput, type SearchSiteInput, truncateSearchQuery } from './site-search-input';

/** Call the same-origin public API directly. Its reader grants, publication
 * lookup, rate limiting and analytics remain authoritative, without a second
 * app-server request and loopback fetch for every keystroke. */
export const searchSiteFn = async (input: { data: SearchSiteInput; signal?: AbortSignal }) => {
  // A query longer than the API accepts is searched by its first 200 code
  // points rather than sent whole and refused with a 422.
  const query = truncateSearchQuery(input.data.query.trim());
  const data = parseSearchSiteInput({ ...input.data, query, ...getSiteSearchAnalytics(input.data.projectId) });
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
