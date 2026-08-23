import { MarketingAnalyticsConsent, marketingAnalyticsEnabled } from '@/components/marketing-analytics-consent';
import { QueryProvider } from '@/integrations/tanstack-query/root-provider';

export function RootMarketingAnalytics({ pathname, siteProjectId, language }: { pathname: string; siteProjectId?: string; language: 'ar' | 'en' }) {
  const enabled = marketingAnalyticsEnabled(pathname, siteProjectId);
  if (!enabled) return null;
  return (
    <QueryProvider>
      <MarketingAnalyticsConsent enabled language={language} />
    </QueryProvider>
  );
}
