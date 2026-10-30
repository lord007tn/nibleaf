import { useT } from '@nibleaf/i18n/react';
import type { AdminPublishRetention } from '@/hooks/api/queries';
import { useFormatters } from '@/lib/format';

/** Aggregate manual-publishing retention. A null value is Unknown, never zero. */
export function PublishRetentionReadout({ retention }: { retention: AdminPublishRetention }) {
  const t = useT();
  const format = useFormatters();
  const unknown = t('admin.overview.retentionUnknown');
  const count = (value: number | null) => (value === null ? unknown : format.number(value));

  const metrics = [
    {
      label: t('admin.overview.firstManualPublishes'),
      value: count(retention.firstManualPublishes),
      help: t('admin.overview.firstManualPublishesHelp'),
    },
    { label: t('admin.overview.retentionCohort'), value: count(retention.cohortSize), help: t('admin.overview.retentionCohortHelp') },
    { label: t('admin.overview.retentionRetained'), value: count(retention.retained), help: t('admin.overview.retentionRetainedHelp') },
    {
      label: t('admin.overview.retentionRate'),
      value: retention.rate === null ? unknown : format.percent(retention.rate * 100),
      help: retention.cohortSize !== null && retention.rate === null ? t('admin.overview.retentionSmallGroup') : null,
    },
  ];

  return (
    <section className="mt-6 border-border border-t pt-4">
      <h3 className="font-medium text-sm">{t('admin.overview.publishRetention')}</h3>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div className="rounded-lg border border-border p-3" key={metric.label}>
            <p className="text-muted-foreground text-xs">{metric.label}</p>
            <p className="mt-1 font-semibold text-2xl tabular-nums tracking-tight">{metric.value}</p>
            {metric.help ? <p className="mt-1 text-muted-foreground text-xs">{metric.help}</p> : null}
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-1 text-muted-foreground text-xs">
        {retention.observationStart ? <p>{t('admin.overview.retentionCoverage', { date: format.date(retention.observationStart) })}</p> : null}
        <p>{t('admin.overview.retentionUpdated', { time: format.dateTime(retention.computedAt) })}</p>
      </div>
    </section>
  );
}
