import { Tabs, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { useT } from '@nibleaf/i18n/react';
import type { AnalyticsRange } from '@/hooks/api';

const ANALYTICS_RANGES: readonly AnalyticsRange[] = ['24h', '7d', '30d', '90d'];

/**
 * The segmented range control shared by both analytics pages and the overview
 * chart: shadcn Tabs with the translated "Last N days" labels, so every surface
 * shows the same control and never a raw "30d".
 */
export function RangeTabs({
  value,
  onValueChange,
  ranges = ANALYTICS_RANGES,
  className,
}: {
  value: AnalyticsRange;
  onValueChange: (range: AnalyticsRange) => void;
  ranges?: readonly AnalyticsRange[];
  /** Applied to the tab list (e.g. `w-full sm:w-fit` to stretch on small screens). */
  className?: string;
}) {
  const t = useT();
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as AnalyticsRange)}>
      <TabsList className={className}>
        {ranges.map((range) => (
          <TabsTrigger key={range} value={range}>
            {t(`analytics.range.${range}`)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
