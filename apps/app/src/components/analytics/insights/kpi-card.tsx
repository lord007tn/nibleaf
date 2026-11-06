import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { SkeletonStatTile } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ArrowDown, ArrowUp, Info, Minus } from 'lucide-react';
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
 * The grid every KPI row sits in: two columns from 340px so a phone sees the
 * numbers side by side; `className` adds the wide-screen column count.
 */
export function KpiGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 sm:gap-4', className)}>{children}</div>;
}

/**
 * A KPI tile for the insights dashboard: the value, its change against the
 * previous period (arrow + %, coloured by whether the change is good news) and
 * a one-line plain-language hint. Unknown values render as "—", never 0.
 *
 * Below `sm` the tile is compact so two fit side by side: smaller padding and
 * value, the "vs. previous period" caption dropped (the badge keeps its spoken
 * label), and the hint moved behind an info button. From `sm` up it is unchanged.
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
  if (loading) {
    // Same grid cell, padding and (roughly) height as the tile, compact on phones like the real one.
    return <SkeletonStatTile className="min-w-0 max-sm:min-h-26 max-sm:gap-2 max-sm:p-3.5 sm:min-h-44 sm:p-6" data-kpi-card="" />;
  }
  return (
    <Card className="@container/card min-w-0 gap-3 max-sm:gap-2 max-sm:[--card-spacing:--spacing(3.5)]" data-kpi-card="">
      <CardHeader className="min-w-0">
        <CardDescription className="flex min-w-0 items-start gap-1.5 max-sm:text-xs sm:items-center">
          {icon ? <span className="shrink-0 max-sm:mt-px max-sm:[&_svg]:size-3.5">{icon}</span> : null}
          <span className="min-w-0 flex-1 break-words">{label}</span>
          {hint ? <KpiHintButton hint={hint} label={label} /> : null}
        </CardDescription>
        <CardTitle className="font-semibold text-xl tabular-nums tracking-tight sm:text-2xl sm:@[220px]/card:text-3xl" data-kpi-value="">
          {format.metric(value, kind)}
        </CardTitle>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-xs">
        {delta ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <DeltaBadge delta={delta} polarity={polarity} />
            <span className="text-muted-foreground max-sm:hidden">{t('analytics.vsPrevious')}</span>
          </span>
        ) : null}
        {hint ? (
          <span className="text-muted-foreground leading-snug max-sm:hidden" data-kpi-hint="">
            {hint}
          </span>
        ) : null}
      </CardFooter>
    </Card>
  );
}

/** Phones only: the KPI's explanation behind a tappable info button instead of a line of small print. */
function KpiHintButton({ label, hint }: { label: string; hint: string }) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('analytics.metric.about', { metric: label })}
        className="-m-1 inline-grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        data-kpi-info=""
      >
        <Info aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 max-w-[calc(100vw-2rem)] gap-1 p-3 text-xs leading-snug">
        <PopoverTitle className="font-medium text-sm">{label}</PopoverTitle>
        <PopoverDescription className="text-muted-foreground">{hint}</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
