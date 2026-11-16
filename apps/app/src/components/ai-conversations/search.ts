import { boundedText, oneOf, readSearch, type SearchOf, trimmedText, withFallback } from '@/lib/search-params';

// The AI dashboard's validateSearch, which ships in the router's eager chunk.
const fields = {
  tab: withFallback(oneOf(['overview', 'conversations', 'gaps']), 'overview'),
  range: withFallback(oneOf(['7d', '30d', '90d']), '30d'),
  language: trimmedText(2, 35),
  rating: oneOf(['up', 'down', 'unrated']),
  status: oneOf(['answered', 'no_answer', 'failed']),
  q: trimmedText(1, 120),
  conversation: boundedText(1, 256),
};
export type AiDashboardSearch = SearchOf<typeof fields>;
export const aiDashboardSearch = { parse: (search: Record<string, unknown>): AiDashboardSearch => readSearch(search, fields) };
