import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { cn } from '@nibleaf/design-system/lib/utils';
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
  unavailable,
  empty,
  refreshing,
}: {
  title: string;
  description: string;
  data: ViewsPoint[];
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  loading?: boolean;
  /** The views couldn't be loaded or aren't known: say so instead of "no traffic yet". */
  unavailable?: boolean;
  /** What an empty plot says, when the page knows better than "no traffic yet" (e.g. a site that is already live). */
  empty?: string;
  /** The shown range stays on screen while another loads: dimmed and marked busy, so it never reads as the new one. */
  refreshing?: boolean;
}) {
  return (
    <Card className="@container/chart">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="col-span-full col-start-1 row-start-3 mt-2 justify-self-stretch sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          <RangeTabs value={range} onValueChange={onRangeChange} ranges={RANGES} className="w-full sm:w-fit" />
        </CardAction>
      </CardHeader>
      <div aria-busy={refreshing || undefined} className={cn('px-2 pb-4 transition-opacity sm:px-6', refreshing && 'opacity-60')}>
        <ViewsTimeseriesChart data={data} empty={empty} loading={loading} unknown={unavailable} />
      </div>
    </Card>
  );
}
