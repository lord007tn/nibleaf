import { TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFormatters } from '@/lib/format';

export type Trend = { pct: number; direction: 'up' | 'down' | 'flat' } | null;

/**
 * A dashboard-01-style KPI card: a label, a large number, an optional trend
 * badge in the corner, and a two-line footer. Used across the global and
 * per-site overviews.
 */
export function SectionCard({
  label,
  value,
  icon,
  trend,
  footer,
  hint,
  loading,
}: {
  label: string;
  value: number;
  icon?: ReactNode;
  trend?: Trend;
  footer?: string;
  hint?: string;
  loading?: boolean;
}) {
  const { number, percent } = useFormatters();
  const TrendIcon = trend?.direction === 'down' ? TrendingDown : TrendingUp;

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
          <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight @[200px]/card:text-3xl">{number(value)}</CardTitle>
        )}
        {trend ? (
          <CardAction>
            <Badge variant="outline" className="gap-1">
              <TrendIcon className="size-3.5" />
              {percent(trend.pct)}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {footer || hint ? (
        <CardFooter className="flex-col items-start gap-1 text-sm">
          {footer ? (
            <div className="flex items-center gap-1.5 font-medium">
              {footer}
              {trend ? <TrendIcon className="size-4 text-muted-foreground" /> : null}
            </div>
          ) : null}
          {hint ? <div className="text-muted-foreground">{hint}</div> : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
