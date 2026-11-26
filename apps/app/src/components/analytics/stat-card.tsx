import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { ReactNode } from 'react';
import { useFormatters } from '@/lib/format';
import { DeltaBadge } from './insights/kpi-card';
import type { Delta } from './insights/metrics';

/**
 * The dashboard's one KPI tile (overviews, workspace analytics): a label, a
 * large number, an optional change badge (the shared insights DeltaBadge, so
 * colour, arrow and spoken text match every analytics page) and a hint line.
 * `null` is unknown and shows "—", never 0.
 */
export function StatCard({
  label,
  value,
  display,
  icon,
  delta,
  hint,
  loading,
  link,
  refreshing,
}: {
  label: string;
  value: number | null;
  /** Pre-formatted text for a non-count value (e.g. a currency); `value === null` still shows "—". */
  display?: string;
  icon?: ReactNode;
  /** Change against the previous equal period; omit when it isn't known. */
  delta?: Delta | null;
  hint?: string;
  loading?: boolean;
  /**
   * Where the number leads (the pages, the team, the publish history, the
   * analytics): a link stretched over the whole tile, named after it. The
   * tile itself stays a plain card for assistive tech.
   */
  link?: ReactNode;
  /** The figure is the previous range's while a new range loads: dimmed and marked busy. */
  refreshing?: boolean;
}) {
  const { number } = useFormatters();
  return (
    <Card
      aria-busy={refreshing || undefined}
      className={cn(
        '@container/card min-w-0 gap-3 transition-opacity',
        refreshing && 'opacity-60',
        link && 'relative transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40 [&_a]:outline-none',
      )}
    >
      <CardHeader>
        <CardDescription className="flex min-w-0 items-start gap-1.5">
          {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
          {/* Long labels ("AI answers completed", Arabic) wrap instead of hiding behind an ellipsis. */}
          <span className="min-w-0 text-pretty leading-snug">{label}</span>
        </CardDescription>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight @[200px]/card:text-3xl">
            {value === null ? '—' : (display ?? number(value))}
          </CardTitle>
        )}
      </CardHeader>
      {/* The change sits on the footer line with its "vs. previous period", not in the header's
          corner, where a narrow tile (two per row on a phone) laid it over the label (WORKSPACE-23). */}
      {(delta || hint) && !loading ? (
        <CardFooter className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
          {/* Only the badge sits above the tile's stretched link (its spoken text shows on hover);
              the rest of the footer still opens the tile's page. */}
          {delta ? (
            <span className="relative z-10">
              <DeltaBadge delta={delta} polarity="higher_is_better" />
            </span>
          ) : null}
          {hint ? <span>{hint}</span> : null}
        </CardFooter>
      ) : null}
      {link}
    </Card>
  );
}

/** KPI tile grid: one per row on the narrowest phones, two from 360px, four
 *  once the dashboard's content column (`@container/inset`) is 768px wide, so
 *  an open sidebar never squeezes four tiles into a tablet-width column. */
export const STAT_GRID = 'grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 @3xl/inset:grid-cols-4';
