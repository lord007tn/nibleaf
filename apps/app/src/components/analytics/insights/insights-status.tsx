import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent } from '@nibleaf/design-system/components/ui/card';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { BarChart3, CirclePause, Clock, ExternalLink, Info, RotateCw } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { FeatureUnavailable } from '@/components/ui/feature-unavailable';
import { useDeployments, useProject } from '@/hooks/api';
import { docsUrl } from '@/lib/docs-url';
import { dataFreshness, type InsightsState } from './insights-data';
import { useInsightFormat } from './use-insight-format';

/** "Data last received 5 min ago", plus a notice when a published site has sent nothing for over a day. */
function FreshnessNotice({ projectId, lastEventAt }: { projectId: string; lastEventAt: string | null | undefined }) {
  const { t } = useLocale();
  const format = useInsightFormat();
  const { data: deployments } = useDeployments(projectId);
  const { data: project } = useProject(projectId);
  const freshness = dataFreshness(lastEventAt);
  if (freshness === 'unknown' || freshness === 'never' || !lastEventAt) return null;
  // From the site's own count: the deployments list is only the newest 50 attempts.
  const published = (project?.readyPublishes ?? 0) > 0 || (deployments ?? []).some((deployment) => deployment.status === 'READY');
  const received = (
    <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <Clock aria-hidden className="size-3.5" />
      <span title={format.dateTime(lastEventAt)}>{t('analytics.freshness.lastReceived', { time: format.relativeTime(lastEventAt) })}</span>
    </p>
  );
  if (freshness === 'fresh' || !published) return received;
  return (
    <Alert>
      <Clock />
      <AlertTitle>{t('analytics.freshness.stale.title')}</AlertTitle>
      <AlertDescription>{t('analytics.freshness.stale.body', { time: format.dateTime(lastEventAt) })}</AlertDescription>
    </Alert>
  );
}

/** Refetching a section's query from its unavailable notice. */
export interface InsightsRetry {
  onRetry: () => void;
  retrying: boolean;
}

/** The retry wiring for a section's query result. */
export const insightsRetry = (result: { refetch: () => unknown; isFetching: boolean }): InsightsRetry => ({
  onRetry: () => void result.refetch(),
  retrying: result.isFetching,
});

/**
 * A section's content region: `aria-busy` with one visually hidden status
 * while the first response loads (the skeleton blocks themselves are hidden
 * from assistive tech).
 */
export function InsightsRegion({ loading, children }: { loading: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <div aria-busy={loading || undefined} className="flex flex-col gap-4" data-insights-region="">
      <p className="sr-only" role="status">
        {loading ? t('common.loading') : null}
      </p>
      {children}
    </div>
  );
}

/**
 * Tells the analytics layout that detailed analytics isn't on for this site, so
 * it drops the range, comparison and section controls: they could change
 * nothing (operations/ui-overhaul.md §6.6, WORKSPACE-01).
 */
const AnalyticsSetupReporter = createContext<(() => void) | null>(null);
export const AnalyticsSetupProvider = AnalyticsSetupReporter.Provider;

/**
 * Detailed analytics is off (not configured, or reads switched off): one
 * `FeatureUnavailable` in place of the section. Plain product words only, no
 * server, operator or storage names, because the same screen shows on Cloud.
 * It points at the Overview, where page views are still counted, so the two
 * pages no longer seem to contradict each other.
 */
function AnalyticsSetupNotice({ projectId }: { projectId: string }) {
  const { t, locale } = useLocale();
  const report = useContext(AnalyticsSetupReporter);
  useEffect(() => report?.(), [report]);
  return (
    <FeatureUnavailable
      action={
        <Button nativeButton={false} render={<Link params={{ projectId }} to="/app/projects/$projectId" />} size="sm">
          {t('analytics.setup.overview')}
        </Button>
      }
      description={t('analytics.setup.body')}
      icon={<BarChart3 />}
      reason="notConfigured"
      secondaryAction={
        <Button
          nativeButton={false}
          render={<a href={docsUrl(locale, 'product/analytics')} rel="noreferrer" target="_blank" />}
          size="sm"
          variant="ghost"
        >
          {t('analytics.setup.learnMore')}
          <ExternalLink aria-hidden className="size-3.5 rtl:-scale-x-100" />
        </Button>
      }
      title={t('analytics.setup.title')}
    />
  );
}

/** The availability notice for a section: unavailable, partial, or the analytics-off notice. */
export function InsightsStatus({ state, projectId, retry }: { state: InsightsState; projectId: string; retry?: InsightsRetry }) {
  const { t } = useLocale();
  if (state.availability === 'unavailable') {
    // An outage of the analytics store is not the owner's problem to fix: say so
    // calmly, in neutral colours, and let them check again.
    return (
      <Alert data-insights-unavailable="">
        <CirclePause />
        <AlertTitle>{t('analytics.status.unavailable.title')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{t('analytics.status.unavailable.body')}</span>
          {retry ? (
            <Button loading={retry.retrying} onClick={retry.onRetry} size="sm" variant="outline">
              <RotateCw aria-hidden />
              {t('analytics.status.retry')}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }
  if (state.availability === 'partial') {
    return (
      <>
        <Alert variant="info">
          <Info />
          <AlertTitle>{t('analytics.status.partial.title')}</AlertTitle>
          <AlertDescription>{t('analytics.status.partial.body')}</AlertDescription>
        </Alert>
        <FreshnessNotice lastEventAt={state.lastEventAt} projectId={projectId} />
      </>
    );
  }
  if (state.availability === 'complete') return <FreshnessNotice lastEventAt={state.lastEventAt} projectId={projectId} />;
  if (state.availability === 'not_configured' || state.availability === 'reads_disabled') return <AnalyticsSetupNotice projectId={projectId} />;
  return null;
}

/** A friendly empty state used when a section has no data for the period yet. */
export function InsightsEmpty({ title, body, icon, action }: { title: string; body: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon ?? <BarChart3 aria-hidden className="size-5" />}
        </span>
        <h2 className="font-medium text-base">{title}</h2>
        <p className="max-w-md text-muted-foreground text-sm">{body}</p>
        {action}
      </CardContent>
    </Card>
  );
}
