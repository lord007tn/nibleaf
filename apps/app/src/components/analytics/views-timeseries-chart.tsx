import { useT } from '@nibleaf/i18n/react';
import { useMemo } from 'react';
import { granularityOf, TrendChart, useSeriesSummary } from './insights/trend-chart';

// A type alias (not an interface) so it satisfies the chart row index signature.
export type ViewsPoint = {
  date: string;
  views: number;
};

/**
 * Page views over time on the overviews and the workspace analytics page: the
 * shared TrendChart with one series, so axes, tooltip, colours, states and the
 * screen-reader summary are identical to every insights chart.
 */
export function ViewsTimeseriesChart({
  data,
  loading,
  unknown,
  className,
}: {
  data: ViewsPoint[];
  loading?: boolean;
  /** The views couldn't be loaded or aren't known: say so instead of "no traffic yet". */
  unknown?: boolean;
  className?: string;
}) {
  const t = useT();
  const summarize = useSeriesSummary();
  const label = t('analytics.pageviews');
  const granularity = granularityOf(data, 'date');
  const series = useMemo(() => [{ key: 'views', label, color: 'var(--chart-1)' }], [label]);
  const summary = summarize(
    label,
    data.map((point) => ({ bucket: point.date, value: point.views })),
    granularity,
  );
  return (
    <TrendChart
      className={className}
      empty={t('analytics.empty.traffic')}
      granularity={granularity}
      loading={loading}
      rows={data}
      series={series}
      summary={summary}
      unknown={unknown}
      xKey="date"
    />
  );
}
