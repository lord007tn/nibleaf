import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent } from '@nibleaf/design-system/components/ui/card';
import { useLocale } from '@nibleaf/i18n/react';
import { AlertTriangle, BarChart3, Clock, Database, ExternalLink, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDeployments } from '@/hooks/api';
import { dataFreshness, type InsightsState } from './insights-data';
import { useInsightFormat } from './use-insight-format';

const CLICKHOUSE_DOCS = 'https://docs.nibleaf.com/self-hosting/clickhouse-analytics';
const CLICKHOUSE_DOCS_AR = 'https://docs.nibleaf.com/ar/self-hosting/clickhouse-analytics';

/** "Data last received 5 min ago", plus a notice when a published site has sent nothing for over a day. */
function FreshnessNotice({ projectId, lastEventAt }: { projectId: string; lastEventAt: string | null | undefined }) {
  const { t } = useLocale();
  const format = useInsightFormat();
  const { data: deployments } = useDeployments(projectId);
  const freshness = dataFreshness(lastEventAt);
  if (freshness === 'unknown' || freshness === 'never' || !lastEventAt) return null;
  const published = (deployments ?? []).some((deployment) => deployment.status === 'READY');
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

/** The availability notice for a section: unavailable, partial, or the not-configured setup card. */
export function InsightsStatus({ state, projectId }: { state: InsightsState; projectId: string }) {
  const { t, locale } = useLocale();
  if (state.availability === 'unavailable') {
    return (
      <Alert variant="warning">
        <AlertTriangle />
        <AlertTitle>{t('analytics.status.unavailable.title')}</AlertTitle>
        <AlertDescription>{t('analytics.status.unavailable.body')}</AlertDescription>
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
  if (state.availability === 'not_configured') {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-2 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <Database aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-base">{t('analytics.status.notConfigured.title')}</h2>
            <p className="mt-1 text-muted-foreground text-sm">{t('analytics.status.notConfigured.body')}</p>
          </div>
          <Button
            nativeButton={false}
            render={<a href={locale.startsWith('ar') ? CLICKHOUSE_DOCS_AR : CLICKHOUSE_DOCS} rel="noreferrer" target="_blank" />}
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
