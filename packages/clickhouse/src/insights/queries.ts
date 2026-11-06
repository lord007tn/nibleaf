import { clickHouseReadsEnabled, keys } from '../keys';
import {
  emptyAiVisibilityInsights,
  emptyFeedbackInsights,
  emptyOverviewInsights,
  emptyPageDetailInsights,
  emptyPagesInsights,
  emptyPerformanceInsights,
  emptySearchInsights,
} from './empty';
import { readPageDetail, readPages } from './pages';
import { InsightsReader, type InsightsScope, SEARCH_TERM_VISIBILITY_THRESHOLD } from './reader';
import { readAiVisibility, readFeedback, readOverview, readPerformance } from './reports';
import { readSearch } from './search';

const query = async <T>(scope: InsightsScope, read: (reader: InsightsReader) => Promise<T>, empty: (scope: InsightsScope) => T): Promise<T> => {
  if (!clickHouseReadsEnabled(keys().ANALYTICS_MODE)) return empty({ ...scope, meta: { ...scope.meta, availability: 'not_configured' } });
  try {
    const reader = new InsightsReader(scope);
    // Exactly one tombstone lookup for the entire endpoint, including overview's
    // component reports. A deleted project never returns physically lagging rows.
    if (!(await reader.ready())) return empty({ ...scope, meta: reader.meta(true) });
    return await read(reader);
  } catch {
    return empty({ ...scope, meta: { ...scope.meta, availability: 'unavailable' } });
  }
};

export const queryOverviewInsights = (scope: InsightsScope) => query(scope, readOverview, (s) => emptyOverviewInsights(s.meta, s.visibility));
export const queryPagesInsights = (scope: InsightsScope) => query(scope, readPages, (s) => emptyPagesInsights(s.meta));
export const queryPageDetailInsights = (scope: InsightsScope, path: string) =>
  query(
    scope,
    (reader) => readPageDetail(reader, path),
    (s) => emptyPageDetailInsights(s.meta, path, s.visibility),
  );
export const querySearchInsights = (scope: InsightsScope) =>
  query(scope, readSearch, (s) => emptySearchInsights(s.meta, s.visibility, SEARCH_TERM_VISIBILITY_THRESHOLD));
export const queryFeedbackInsights = (scope: InsightsScope) => query(scope, readFeedback, (s) => emptyFeedbackInsights(s.meta));
export const queryAiVisibilityInsights = (scope: InsightsScope) => query(scope, readAiVisibility, (s) => emptyAiVisibilityInsights(s.meta));
export const queryPerformanceInsights = (scope: InsightsScope) => query(scope, readPerformance, (s) => emptyPerformanceInsights(s.meta));
