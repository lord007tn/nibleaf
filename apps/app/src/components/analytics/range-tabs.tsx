import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { useT } from '@nibleaf/i18n/react';
import type { AnalyticsRange } from '@/hooks/api';

const ANALYTICS_RANGES: readonly AnalyticsRange[] = ['24h', '7d', '30d', '90d'];

/**
 * The range presets shared by the analytics pages, the overview charts and AI
 * conversations: a named group of pressed-state buttons (it filters the data
 * on the page; it is not a set of tabs with panels), with the translated
 * "Last N days" labels so a surface never shows a raw "30d".
 */
export function RangeTabs({
  value,
  onValueChange,
  ranges = ANALYTICS_RANGES,
  className,
}: {
  /** null when none of the presets is active (e.g. a custom date range). */
  value: AnalyticsRange | null;
  onValueChange: (range: AnalyticsRange) => void;
  ranges?: readonly AnalyticsRange[];
  /** Applied to the group (e.g. `w-full sm:w-fit` to stretch on small screens). */
  className?: string;
}) {
  const t = useT();
  return (
    <SegmentedControl aria-label={t('analytics.range.label')} className={className} role="group">
      {ranges.map((range) => (
        <SegmentedControlItem active={value === range} key={range} onClick={() => onValueChange(range)}>
          {t(`analytics.range.${range}`)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
