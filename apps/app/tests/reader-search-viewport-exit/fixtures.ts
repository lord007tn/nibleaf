import type { SiteSearchHit } from '../../src/hooks/api/types';

// Fixture boundaries leave query state, reader markup, viewport retention,
// Dialog, Base UI and CSS running from production source.
export const useSiteAnalytics = () => ({ track: () => undefined });

// Start normally removes site-origin's server branch. This standalone client
// fixture uses its exact client result without importing the server runtime.
export const customDomainOrigin = (): string | undefined => undefined;

export async function searchSiteFn({ data, signal }: { data: { query: string; prefer?: string }; signal?: AbortSignal }): Promise<SiteSearchHit[]> {
  const response = await fetch(`/api/public/sites/preview-harbor/search?q=${encodeURIComponent(data.query)}`, { signal });
  if (!response.ok) throw new Error(`Fictional search failed: ${response.status}`);
  await response.json();
  return Array.from({ length: 30 }, (_, index) => ({
    id: `fictional-${index}`,
    path: `/guide-${index}`,
    language: data.prefer ?? 'en',
    score: 30 - index,
    title: data.prefer === 'ar' ? `دليل البحث ${index + 1}` : `Search guide ${index + 1}`,
    description: '',
    snippet: data.prefer === 'ar' ? 'نتيجة محلية خيالية لاختبار حجم نافذة البحث.' : 'Fictional local result for search viewport testing.',
  }));
}
