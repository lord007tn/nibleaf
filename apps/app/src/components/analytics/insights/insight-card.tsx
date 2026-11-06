import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import type { ReactNode } from 'react';
import { DeltaBadge } from './kpi-card';
import type { Delta, MetricPolarity } from './metrics';
import { useInsightFormat } from './use-insight-format';

/** A titled dashboard card: a question-style title, a plain explanation and an optional header action. */
export function InsightCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      {action ? (
        // With an action the header wraps instead of squeezing: on a phone a long
        // (Arabic) title keeps its width and the link drops below it.
        <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-1">
            <CardTitle>
              <h2 className="font-semibold text-base">{title}</h2>
            </CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <div className="max-w-full shrink-0">{action}</div>
        </CardHeader>
      ) : (
        <CardHeader>
          <CardTitle>
            <h2 className="font-semibold text-base">{title}</h2>
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      )}
      <CardContent className={cn('min-w-0', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** A page path, always laid out left-to-right so slashes and slugs never reorder in Arabic. */
export function PathText({ path, className }: { path: string; className?: string }) {
  const display = `/${path.replace(/^\/+/, '')}`;
  return (
    <span className={cn('truncate font-mono text-xs', className)} dir="ltr" title={display}>
      {display}
    </span>
  );
}

/** A page's title (in its own direction) over its path. */
export function PageLabel({ title, path }: { title: string | null; path: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      {title ? (
        <span className="truncate font-medium text-foreground text-sm" dir="auto">
          {title}
        </span>
      ) : null}
      <PathText className={title ? 'text-muted-foreground' : 'text-foreground'} path={path} />
    </span>
  );
}

export interface RankedItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Shown instead of the formatted value (e.g. a rate). */
  display?: string;
  delta?: Delta | null;
  meta?: ReactNode;
}

/** A ranked list with proportional bars, used for top pages, channels, referrers… */
export function RankedList({
  items,
  empty,
  loading,
  unknown,
  polarity = 'higher_is_better',
  rows = 5,
  label,
}: {
  items: RankedItem[];
  /** Text, or a richer explanation (e.g. why search terms are hidden). */
  empty: ReactNode;
  loading?: boolean;
  unknown?: boolean;
  polarity?: MetricPolarity;
  rows?: number;
  /** Accessible name for the list. */
  label?: string;
}) {
  const t = useT();
  const format = useInsightFormat();
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders have no stable id
          <Skeleton className="h-6 w-full" key={index} />
        ))}
      </div>
    );
  }
  if (unknown || items.length === 0) {
    if (!unknown && typeof empty !== 'string') return empty;
    return <p className="py-6 text-center text-muted-foreground text-sm">{unknown ? t('analytics.state.unknown') : empty}</p>;
  }
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul aria-label={label} className="space-y-1">
      {items.map((item) => (
        <li className="relative isolate flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-sm" key={item.key}>
          <span
            aria-hidden
            className="-z-10 absolute inset-y-0 start-0 rounded-md bg-muted"
            style={{ width: `${Math.max(2, Math.round((item.value / max) * 100))}%` }}
          />
          <span className="flex min-w-0 flex-1 items-center gap-2">{item.label}</span>
          {item.meta ? <span className="shrink-0 text-muted-foreground text-xs">{item.meta}</span> : null}
          {item.delta ? <DeltaBadge delta={item.delta} polarity={polarity} /> : null}
          <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{item.display ?? format.count(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}
