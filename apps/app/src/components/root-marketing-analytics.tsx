import { lazy, Suspense } from 'react';
import { marketingAnalyticsEnabled } from '@/lib/marketing-analytics-route';

// Published readers never use platform marketing analytics. Keep the consent
// UI and its Public Suffix List out of their initial route preloads.
const MarketingAnalyticsConsent = lazy(() =>
  import('@/components/marketing-analytics-consent').then((module) => ({ default: module.MarketingAnalyticsConsent })),
);

export function RootMarketingAnalytics({ pathname, siteProjectId, language }: { pathname: string; siteProjectId?: string; language: 'ar' | 'en' }) {
  const enabled = marketingAnalyticsEnabled(pathname, siteProjectId);
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <MarketingAnalyticsConsent enabled language={language} />
    </Suspense>
  );
}
