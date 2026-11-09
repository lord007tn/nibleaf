import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { ReactNode } from 'react';
import { useFormatters } from '@/lib/format';
import { DeltaBadge } from './insights/kpi-card';
import type { Delta } from './insights/metrics';

/**
 * A dashboard-01-style KPI card: a label, a large number, an optional change
 * badge in the corner (the shared insights DeltaBadge, so colour, arrow and
 * the spoken text match every analytics page), and a two-line footer. Used
 * across the global and per-site overviews.
 */
export function SectionCard({
  label,
  value,
  icon,
  delta,
  footer,
  hint,
  loading,
}: {
  label: string;
  value: number | null;
  icon?: ReactNode;
  /** Change against the previous equal period; omit when it isn't known. */
  delta?: Delta | null;
  footer?: string;
  hint?: string;
  loading?: boolean;
}) {
  const { number } = useFormatters();

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight @[200px]/card:text-3xl">
            {value === null ? '—' : number(value)}
          </CardTitle>
        )}
        {delta && !loading ? (
          <CardAction>
            <DeltaBadge delta={delta} polarity="higher_is_better" />
          </CardAction>
        ) : null}
      </CardHeader>
      {footer || hint ? (
        <CardFooter className="flex-col items-start gap-1 text-sm">
          {footer ? <div className="flex items-center gap-1.5 font-medium">{footer}</div> : null}
          {hint ? <div className="text-muted-foreground">{hint}</div> : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
