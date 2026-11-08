import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
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
}) {
  const { number } = useFormatters();
  return (
    <Card className="@container/card min-w-0 gap-3">
      <CardHeader>
        <CardDescription className="flex min-w-0 items-center gap-1.5">
          {icon ? <span className="shrink-0 [&_svg]:size-4">{icon}</span> : null}
          <span className="truncate">{label}</span>
        </CardDescription>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight @[200px]/card:text-3xl">
            {value === null ? '—' : (display ?? number(value))}
          </CardTitle>
        )}
        {delta && !loading ? (
          <CardAction>
            <DeltaBadge delta={delta} polarity="higher_is_better" />
          </CardAction>
        ) : null}
      </CardHeader>
      {hint && !loading ? <CardFooter className={cn('text-muted-foreground text-xs')}>{hint}</CardFooter> : null}
    </Card>
  );
}

/** KPI tile grid: one per row on the narrowest phones, two from 360px, four on wide screens. */
export const STAT_GRID = 'grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-4';
