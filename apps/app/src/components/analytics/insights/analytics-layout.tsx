import { useT } from '@nibleaf/i18n/react';
import { type ReactNode, useCallback, useState } from 'react';
import { InsightsFilterBar } from './filter-bar';
import type { InsightsSearch } from './filters';
import { AnalyticsSetupProvider } from './insights-status';
import { InsightsSectionNav } from './section-nav';

/**
 * The site Analytics page: heading, the shared filters and the section links,
 * then the current section. When a section finds detailed analytics off for
 * this site it says so once, and the filters and section links go away: none of
 * them could change what the page shows (WORKSPACE-01). The answer is the
 * server's, the same for every section, so it holds while the person moves
 * between sections.
 */
export function AnalyticsLayout({
  projectId,
  filters,
  onFiltersChange,
  timezone,
  children,
}: {
  projectId: string;
  filters: InsightsSearch;
  onFiltersChange: (next: InsightsSearch) => void;
  timezone: string;
  children: ReactNode;
}) {
  const t = useT();
  // Keyed by site, so switching to another site asks again.
  const [offFor, setOffFor] = useState<string | null>(null);
  const reportAnalyticsOff = useCallback(() => setOffFor(projectId), [projectId]);
  const analyticsOff = offFor === projectId;
  return (
    // `contain: inline-size` keeps wide tables from widening the dashboard shell's
    // flex column: they scroll inside their own card instead of the page.
    <div className="w-full min-w-0 px-4 py-6 [contain:inline-size] sm:px-6 sm:py-8 xl:px-10">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('analytics.insights.subtitle')}</p>
        </div>
        {analyticsOff ? null : (
          <>
            <InsightsFilterBar filters={filters} onChange={onFiltersChange} timezone={timezone} />
            <InsightsSectionNav filters={filters} projectId={projectId} />
          </>
        )}
      </div>
      <div className="mt-6">
        <AnalyticsSetupProvider value={reportAnalyticsOff}>{children}</AnalyticsSetupProvider>
      </div>
    </div>
  );
}
