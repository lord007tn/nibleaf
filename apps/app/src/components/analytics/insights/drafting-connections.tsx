import { useT } from '@nibleaf/i18n/react';
import type { AiVisibilityInsights } from '@/hooks/api/analytics';
import { SimpleTable } from './data-table';
import { InsightCard } from './insight-card';
import { useInsightFormat } from './use-insight-format';

type Connection = AiVisibilityInsights['drafting']['connections'][number];

export function DraftingConnections({
  data,
  loading,
  unknown,
}: {
  data: AiVisibilityInsights['drafting'] | undefined;
  loading: boolean;
  unknown: boolean;
}) {
  const t = useT();
  const format = useInsightFormat();
  const unavailable = unknown || data?.total === null;
  return (
    <InsightCard title={t('analytics.drafting.title')} description={t('analytics.drafting.description')}>
      <p className="mb-3 text-sm">{t('analytics.drafting.total', { total: format.count(loading || unavailable ? null : (data?.total ?? null)) })}</p>
      <SimpleTable
        caption={t('analytics.drafting.title')}
        columns={[
          {
            key: 'connection',
            header: t('analytics.drafting.connection'),
            cell: (row: Connection) => (
              <div className="max-w-48 whitespace-normal">
                <span>{t(`analytics.drafting.${row.connection}`)}</span>
                <p className="mt-1 break-all text-muted-foreground text-xs" dir="ltr" title={t('analytics.drafting.models')}>
                  {row.models
                    .map(([provider, model]) => [provider, model].filter(Boolean).join(' / '))
                    .filter(Boolean)
                    .join(', ') || format.count(null)}
                </p>
              </div>
            ),
          },
          { key: 'events', header: t('analytics.drafting.events'), cell: (row: Connection) => format.count(row.events), numeric: true },
          { key: 'share', header: t('analytics.drafting.share'), cell: (row: Connection) => format.rate(row.share), numeric: true },
        ]}
        empty={t('analytics.drafting.empty')}
        loading={loading}
        rowKey={(row) => row.connection}
        rows={data?.connections ?? []}
        unknown={unavailable}
      />
    </InsightCard>
  );
}
