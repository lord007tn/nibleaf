import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import type { AnalyticsRange } from '@/hooks/api';
import { RangeTabs } from './range-tabs';
import { type ViewsPoint, ViewsTimeseriesChart } from './views-timeseries-chart';

const RANGES: readonly AnalyticsRange[] = ['7d', '30d', '90d'];

/**
 * The dashboard-01 "interactive" chart: a gradient area of page views over time
 * with a range toggle. The parent owns the selected range (so the data query
 * refetches); this component just renders + switches.
 */
export function ViewsAreaChart({
  title,
  description,
  data,
  range,
  onRangeChange,
  loading,
}: {
  title: string;
  description: string;
  data: ViewsPoint[];
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  loading?: boolean;
}) {
  const t = useT();
  const hasData = data.some((d) => d.views > 0);

  return (
    <Card className="@container/chart">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="col-span-full col-start-1 row-start-3 mt-2 justify-self-stretch sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          <RangeTabs value={range} onValueChange={onRangeChange} ranges={RANGES} className="w-full sm:w-fit" />
        </CardAction>
      </CardHeader>
      <div className="px-2 pb-4 sm:px-6">
        {loading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : hasData ? (
          <ViewsTimeseriesChart data={data} />
        ) : (
          <div className="grid h-[240px] place-items-center text-center text-muted-foreground text-sm">{t('analytics.empty.traffic')}</div>
        )}
      </div>
    </Card>
  );
}
