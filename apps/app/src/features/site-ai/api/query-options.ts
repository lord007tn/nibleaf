import { queryOptions } from '@tanstack/react-query';
import { workspaceAiQueryOptions } from '@/hooks/api/query-options';
import type { SiteAi } from '../model/ai';

/*
 * Query factory for the AI answers page. It reads the same cache entry as
 * Smart AI (`GET /app/projects/:projectId/settings/ai`), so saving a key or
 * choosing a source there updates both, and nothing is fetched twice. Loaders
 * import this module, so it stays light: no hooks, components or i18n
 * (operations/ui-overhaul.md §8.1).
 */

/** The server's capabilities, the site's AI status and the viewer's permissions, as the model takes them. */
const selectSiteAi = (data: SiteAi): SiteAi => ({ capabilities: data.capabilities, status: data.status, viewer: data.viewer });

/** While the docs are being prepared, the page follows the run. */
const PREPARING_POLL_MS = 3000;

export const siteAiQueryOptions = (projectId: string) =>
  queryOptions({
    ...workspaceAiQueryOptions(projectId),
    select: selectSiteAi,
    refetchInterval: (query) => (query.state.data?.status.preparation.state === 'running' ? PREPARING_POLL_MS : false),
  });
