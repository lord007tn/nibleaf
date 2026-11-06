import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { type InsightsSearch, toInsightsQuery, validateInsightsSearch } from './filters';

const analyticsRoute = getRouteApi('/app/projects/$projectId/analytics');

const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * The analytics filters, owned by the URL (`?range=7d&compare=none`, or
 * `?range=custom&from=…&to=…`) so a view is shareable and back/forward walks
 * through filter changes. The timezone always comes from the browser.
 */
export function useInsightsFilters() {
  const search = analyticsRoute.useSearch();
  const { projectId } = analyticsRoute.useParams();
  const navigate = useNavigate();
  const [timezone] = useState(browserTimezone);
  const filters = validateInsightsSearch(search as Record<string, unknown>);
  const setFilters = (next: InsightsSearch) => {
    void navigate({
      to: '.',
      // Section-only params (the drill-down `path`) survive a filter change.
      search: (previous: Record<string, unknown>) => {
        const { range: _range, from: _from, to: _to, compare: _compare, ...rest } = previous;
        return { ...rest, ...validateInsightsSearch(next as Record<string, unknown>) };
      },
    });
  };
  return { projectId, filters, setFilters, timezone, query: toInsightsQuery(filters, timezone) };
}
