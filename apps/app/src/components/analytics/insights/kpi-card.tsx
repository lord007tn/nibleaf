import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { type Compared, compareDelta, type Delta, deltaTone, type MetricKind, type MetricPolarity } from './metrics';
import { useInsightFormat } from './use-insight-format';

const TONE_CLASS = {
  good: 'text-success',
  bad: 'text-destructive',
  neutral: 'text-muted-foreground',
} as const;

/** "↑ +12%" coloured by meaning (a rise in zero-result searches is red), with a spoken label. */
export function DeltaBadge({ delta, polarity, className }: { delta: Delta; polarity: MetricPolarity; className?: string }) {
  const t = useT();
  const format = useInsightFormat();
  const tone = deltaTone(delta, polarity);
  const Icon = delta.direction === 'up' ? ArrowUp : delta.direction === 'down' ? ArrowDown : Minus;
  const amount =
    delta.mode === 'new'
      ? t('analytics.delta.new')
      : delta.mode === 'points'
        ? t('analytics.delta.points', { value: format.delta(delta) })
        : format.delta(delta);
  const spoken =
    delta.mode === 'new'
      ? t('analytics.delta.newSpoken')
      : delta.direction === 'flat'
        ? t('analytics.delta.flatSpoken')
        : t(delta.direction === 'up' ? 'analytics.delta.upSpoken' : 'analytics.delta.downSpoken', { value: amount });
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium text-xs tabular-nums', TONE_CLASS[tone], className)} title={spoken}>
      <Icon aria-hidden className="size-3.5" />
      <span aria-hidden>{amount}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/**
 * A KPI tile for the insights dashboard: the value, its change against the
 * previous period (arrow + %, coloured by whether the change is good news) and
 * a one-line plain-language hint. Unknown values render as "—", never 0.
 */
export function KpiCard({
  label,
  compared,
  kind,
  polarity,
  hint,
  icon,
  loading,
}: {
  label: string;
  compared: Compared | undefined;
  kind: MetricKind;
  polarity: MetricPolarity;
  hint?: string;
  icon?: ReactNode;
  loading?: boolean;
}) {
  const t = useT();
  const format = useInsightFormat();
  const value = compared?.value ?? null;
  const delta = compared ? compareDelta(compared, kind) : null;
  return (
    <Card className="@container/card gap-3">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight @[220px]/card:text-3xl">{format.metric(value, kind)}</CardTitle>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-xs">
        {loading ? null : delta ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <DeltaBadge delta={delta} polarity={polarity} />
            <span className="text-muted-foreground">{t('analytics.vsPrevious')}</span>
          </span>
        ) : null}
        {hint ? <span className="text-muted-foreground leading-snug">{hint}</span> : null}
      </CardFooter>
    </Card>
  );
}
