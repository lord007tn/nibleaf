import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { WebVitalsSummary } from '@/hooks/api/analytics';
import { useInsightFormat } from './use-insight-format';
import { rateVital, type VitalMetric, type VitalRating } from './web-vitals';

const RATING_LABELS: Record<VitalRating, MessageKey> = {
  good: 'analytics.vitals.rating.good',
  needs_improvement: 'analytics.vitals.rating.needsImprovement',
  poor: 'analytics.vitals.rating.poor',
};

const RATING_CLASS: Record<VitalRating, string> = {
  good: 'border-success/30 bg-success/10 text-success',
  needs_improvement: 'border-warning/30 bg-warning/10 text-warning',
  poor: 'border-destructive/30 bg-destructive/10 text-destructive',
};

/** Good / needs improvement / poor, coloured with the semantic status tokens. */
export function RatingBadge({ rating }: { rating: VitalRating | null }) {
  const t = useT();
  if (!rating) return <span className="text-muted-foreground text-xs">{t('analytics.vitals.rating.unknown')}</span>;
  return (
    <Badge className={cn('border', RATING_CLASS[rating])} variant="outline">
      {t(RATING_LABELS[rating])}
    </Badge>
  );
}

/**
 * The metric's standard name is a proper noun, the same in every language, so
 * it isn't in the catalogs: the card shows its abbreviation as an isolated
 * English term with the full name, and the translated hint explains it.
 */
const VITALS: ReadonlyArray<{
  metric: VitalMetric;
  field: 'lcpP75Ms' | 'inpP75Ms' | 'clsP75';
  label: MessageKey;
  hint: MessageKey;
  abbreviation: string;
  name: string;
}> = [
  {
    metric: 'lcp',
    field: 'lcpP75Ms',
    label: 'analytics.vitals.lcp',
    hint: 'analytics.vitals.lcp.hint',
    abbreviation: 'LCP',
    name: 'Largest Contentful Paint',
  },
  {
    metric: 'inp',
    field: 'inpP75Ms',
    label: 'analytics.vitals.inp',
    hint: 'analytics.vitals.inp.hint',
    abbreviation: 'INP',
    name: 'Interaction to Next Paint',
  },
  {
    metric: 'cls',
    field: 'clsP75',
    label: 'analytics.vitals.cls',
    hint: 'analytics.vitals.cls.hint',
    abbreviation: 'CLS',
    name: 'Cumulative Layout Shift',
  },
];

/** The three Core Web Vitals at p75 with a rating and what each one means for a reader. */
export function VitalsCards({ summary, loading, unknown }: { summary: WebVitalsSummary | undefined; loading?: boolean; unknown?: boolean }) {
  const t = useT();
  const format = useInsightFormat();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {VITALS.map((vital) => {
        const value = unknown ? null : (summary?.[vital.field] ?? null);
        const display = vital.metric === 'cls' ? format.decimal(value) : format.ms(value);
        return (
          <Card className="@container/card gap-3" key={vital.metric}>
            <CardHeader>
              <CardDescription className="flex flex-wrap items-baseline gap-x-2">
                {t(vital.label)}
                <abbr
                  className="cursor-help font-mono text-[11px] underline decoration-dotted underline-offset-2"
                  dir="ltr"
                  lang="en"
                  title={vital.name}
                >
                  {vital.abbreviation}
                </abbr>
              </CardDescription>
              {loading ? (
                <Skeleton aria-hidden className="mt-1 h-8 w-20" />
              ) : (
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-2xl tabular-nums tracking-tight">{display}</span>
                  <RatingBadge rating={rateVital(vital.metric, value)} />
                </CardTitle>
              )}
            </CardHeader>
            <CardFooter className="text-muted-foreground text-xs leading-snug">{t(vital.hint)}</CardFooter>
          </Card>
        );
      })}
    </div>
  );
}

/** The share of page loads per rating as one stacked bar with a legend. */
export function RatingDistribution({ rating }: { rating: WebVitalsSummary['rating'] }) {
  const t = useT();
  const format = useInsightFormat();
  if (!rating) return <p className="text-muted-foreground text-sm">{t('analytics.vitals.noSamples')}</p>;
  const parts: Array<{ key: VitalRating; value: number; className: string }> = [
    { key: 'good', value: rating.good, className: 'bg-success' },
    { key: 'needs_improvement', value: rating.needsImprovement, className: 'bg-warning' },
    { key: 'poor', value: rating.poor, className: 'bg-destructive' },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {parts.map((part) => (
          <span className={cn('h-full', part.className)} key={part.key} style={{ width: `${Math.round(part.value * 100)}%` }} />
        ))}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((part) => (
          <div className="flex items-center gap-1.5" key={part.key}>
            <span aria-hidden className={cn('size-2.5 rounded-[2px]', part.className)} />
            <dt className="text-muted-foreground">{t(RATING_LABELS[part.key])}</dt>
            <dd className="font-medium tabular-nums">{format.rate(part.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
