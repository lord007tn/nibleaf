import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent } from '@nibleaf/design-system/components/ui/card';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { BarChart3, CirclePause, Clock, Database, ExternalLink, Info, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
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

/** The availability notice for a section: unavailable, partial, or the not-configured setup card. */
export function InsightsStatus({ state, projectId, retry }: { state: InsightsState; projectId: string; retry?: InsightsRetry }) {
  const { t, locale } = useLocale();
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
  if (state.availability === 'not_configured' || state.availability === 'reads_disabled') {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-2 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <Database aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-base">
              {t(state.availability === 'reads_disabled' ? 'analytics.status.readsDisabled.title' : 'analytics.status.notConfigured.title')}
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              {t(state.availability === 'reads_disabled' ? 'analytics.status.readsDisabled.body' : 'analytics.status.notConfigured.body')}
            </p>
          </div>
          <Button
            nativeButton={false}
            render={<a href={docsUrl(locale, 'self-hosting/clickhouse-analytics')} rel="noreferrer" target="_blank" />}
            size="sm"
            variant="outline"
          >
            {t('analytics.status.notConfigured.action')}
            <ExternalLink aria-hidden className="size-3.5" />
          </Button>
        </CardContent>
      </Card>
    );
  }
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
