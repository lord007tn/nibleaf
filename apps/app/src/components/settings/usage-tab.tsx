import { SkeletonStatTile } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { LimitState, UsageAvailability } from '@nibleaf/usage';
import { Link } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Boxes,
  Database,
  Eye,
  Files,
  Globe2,
  HardDrive,
  type LucideIcon,
  Rocket,
  Search,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { QueryErrorState } from '@/components/query-error-state';
import type { Project } from '@/hooks/api';
import { useProjectUsage } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { formatByteQuantity } from '@/lib/usage-format';
import { SettingsSection } from './section';

const meterPresentation: Record<string, { icon: LucideIcon; label: MessageKey }> = {
  editor_seat: { icon: Users, label: 'settings.usage.meter.editorSeat' },
  asset_storage_byte: { icon: HardDrive, label: 'settings.usage.meter.assetStorage' },
  custom_domain: { icon: Globe2, label: 'settings.usage.meter.customDomain' },
  published_page: { icon: Files, label: 'settings.usage.meter.publishedPage' },
  public_page_view: { icon: Eye, label: 'settings.usage.meter.publicPageView' },
  search_query: { icon: Search, label: 'settings.usage.meter.searchQuery' },
  ai_answer: { icon: Bot, label: 'settings.usage.meter.aiAnswer' },
  ai_input_token: { icon: ArrowDownToLine, label: 'settings.usage.meter.aiInputToken' },
  ai_output_token: { icon: ArrowUpFromLine, label: 'settings.usage.meter.aiOutputToken' },
  embedded_chunk: { icon: Boxes, label: 'settings.usage.meter.embeddedChunk' },
  indexed_content_byte: { icon: Database, label: 'settings.usage.meter.indexedContent' },
  build: { icon: Rocket, label: 'settings.usage.meter.build' },
};

const groups = [
  {
    title: 'settings.usage.group.capacity' as const,
    description: 'settings.usage.group.capacity.description' as const,
    keys: ['published_page', 'editor_seat', 'asset_storage_byte', 'custom_domain'],
  },
  {
    title: 'settings.usage.group.delivery' as const,
    description: 'settings.usage.group.delivery.description' as const,
    keys: ['build', 'public_page_view'],
  },
  {
    title: 'settings.usage.group.searchAi' as const,
    description: 'settings.usage.group.searchAi.description' as const,
    keys: ['search_query', 'ai_answer', 'ai_input_token', 'ai_output_token', 'embedded_chunk', 'indexed_content_byte'],
  },
];

const stateKeys: Record<LimitState, MessageKey> = {
  available: 'settings.usage.state.available',
  approaching: 'settings.usage.state.approaching',
  exceeded: 'settings.usage.state.exceeded',
  unknown: 'settings.usage.state.unknown',
  unlimited: 'settings.usage.state.unlimited',
};

const availabilityKeys: Record<UsageAvailability, MessageKey> = {
  complete: 'settings.usage.availability.complete',
  partial: 'settings.usage.availability.partial',
  unavailable: 'settings.usage.availability.unavailable',
};

const planLabelKeys: ReadonlyMap<string, MessageKey> = new Map([['free', 'settings.usage.plan.free']]);

type UsageSummary = NonNullable<ReturnType<typeof useProjectUsage>['data']>;
type Meter = UsageSummary['meters'][number];

/** Why a number is missing, named instead of a bare "Unknown" (audit WORKSPACE-19). */
const unavailableReasonKeys = {
  metering_disabled: 'settings.usage.reason.meteringDisabled',
  query_failed: 'settings.usage.reason.queryFailed',
  delayed: 'settings.usage.reason.delayed',
  catching_up: 'settings.usage.reason.catchingUp',
  tokens_incomplete: 'settings.usage.reason.tokensIncomplete',
  not_measured: 'settings.usage.reason.notMeasured',
  seats_unavailable: 'settings.usage.reason.seatsUnavailable',
} as const satisfies Record<NonNullable<Meter['unavailableReason']> | 'seats_unavailable', string>;
/** The explanation for a missing number; the generic line only for an unknown cause. */
export const unavailableExplanationKey = (reason: string | null | undefined) =>
  reason && reason in unavailableReasonKeys
    ? unavailableReasonKeys[reason as keyof typeof unavailableReasonKeys]
    : ('settings.usage.unknownExplanation' as const);

/**
 * Website usage (§7, review #20): this website's pages, storage, traffic and AI —
 * no plan, no seats, no limits. Plan and billing live with the organization,
 * so the header points there (a link only for org Owner/Admin).
 */
export function UsageTab({ project, organization }: { project: Project; organization?: { slug: string; name: string; canManage: boolean } }) {
  const t = useT();
  const { data: usage, isPending, isError, isFetching, refetch } = useProjectUsage(project.id);

  if (isError || (!isPending && !usage)) {
    return <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} />;
  }
  return (
    <UsageOverview
      description={t('settings.usage.websiteDescription')}
      hiddenMeters={WEBSITE_HIDDEN_METERS}
      isPending={isPending}
      notice={organization ? <BillingPointer organization={organization} /> : null}
      title={t('settings.usage.title')}
      usage={usage}
    />
  );
}

/** Seats are an organization figure, computed once per org (§10.3). */
const WEBSITE_HIDDEN_METERS = new Set(['editor_seat']);

/** "Plan and billing are managed by <Org> →" — the arrow link only for those who can open billing. */
function BillingPointer({ organization }: { organization: { slug: string; name: string; canManage: boolean } }) {
  const t = useT();
  return (
    <p className="text-muted-foreground text-sm" data-slot="billing-pointer">
      {t('settings.usage.billingManagedBy')}{' '}
      {organization.canManage ? (
        <Link
          className="font-medium text-primary underline-offset-4 hover:underline"
          params={{ orgSlug: organization.slug }}
          to="/app/o/$orgSlug/billing"
        >
          <bdi>{organization.name}</bdi>{' '}
          <span aria-hidden className="inline-block rtl:-scale-x-100">
            →
          </span>
        </Link>
      ) : (
        <bdi className="font-medium text-foreground">{organization.name}</bdi>
      )}
    </p>
  );
}

/** The meter grid shared by website usage and the org's Usage & billing page. */
export function UsageOverview({
  usage,
  isPending,
  title,
  description,
  planKey,
  notice,
  hiddenMeters,
}: {
  usage: (Pick<UsageSummary, 'meters' | 'period'> & { availability?: UsageSummary['availability'] }) | undefined;
  isPending: boolean;
  title: string;
  description: string;
  /** The org's plan badge; omitted on website usage. */
  planKey?: string | null;
  notice?: ReactNode;
  hiddenMeters?: ReadonlySet<string>;
}) {
  const t = useT();
  const { date, number } = useFormatters();
  return (
    <div aria-busy={isPending} className="flex flex-col gap-6">
      {isPending ? (
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
      ) : null}
      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-xl tracking-tight">{title}</h2>
            <p className="mt-1 max-w-2xl text-muted-foreground text-sm">{description}</p>
          </div>
          {planKey !== undefined ? (
            <span className="rounded-full border border-border bg-background px-3 py-1.5 font-medium text-sm">
              {t(planLabelKeys.get(planKey ?? '') ?? 'settings.usage.plan.unconfigured')}
            </span>
          ) : null}
        </div>
        {notice ? <div className="mt-3">{notice}</div> : null}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-t pt-4 text-muted-foreground text-xs">
          <span>
            {usage
              ? t('settings.usage.period', {
                  start: date(usage.period.start),
                  end: date(new Date(new Date(usage.period.endExclusive).getTime() - 1)),
                })
              : t('settings.usage.period.loading')}
          </span>
          <span aria-live="polite">{usage?.availability ? t(availabilityKeys[usage.availability]) : null}</span>
        </div>
      </header>

      {groups.map((group) => {
        const keys = group.keys.filter((key) => !hiddenMeters?.has(key));
        const metrics = usage?.meters.filter((metric: Meter) => keys.includes(metric.key)) ?? [];
        return (
          <SettingsSection description={t(group.description)} key={group.title} title={t(group.title)}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {isPending
                ? keys.map((key) => <SkeletonStatTile className="min-h-36" key={key} />)
                : metrics.map((metric) => {
                    const presentation = meterPresentation[metric.key] ?? {
                      icon: Database,
                      label: 'settings.usage.meter.unknown' as const,
                    };
                    const Icon = presentation.icon;
                    const formatQuantity = (value: string) => {
                      const quantity = BigInt(value);
                      if (metric.unit !== 'byte') return number(quantity);
                      return formatByteQuantity(value, {
                        number,
                        decimal: (whole, fraction) => t('settings.usage.decimal', { whole, fraction }),
                        unit: (valueLabel, unit) =>
                          t('settings.usage.unit', {
                            value: valueLabel,
                            unit: t(
                              unit === 'gib' ? 'settings.usage.unit.gib' : unit === 'mib' ? 'settings.usage.unit.mib' : 'settings.usage.unit.byte',
                            ),
                          }),
                      });
                    };
                    // The real share of the limit, which can pass 100%. The bar keeps a 2% sliver so a tiny
                    // positive amount stays visible, but that minimum is drawing only: assistive tech hears the truth.
                    // No ratio with a limit means a zero limit: there is no share to announce, only
                    // whether it is exceeded (any use of a 0 limit is), so never invent "0%".
                    const share = metric.ratio === null ? null : metric.ratio * 100;
                    const percent = share ?? (metric.state === 'exceeded' ? 100 : 0);
                    const barWidth = Math.min(100, Math.max(percent > 0 ? 2 : 0, percent));
                    const unavailable = metric.quantity === null;
                    const limit = 'limit' in metric && typeof metric.limit === 'string' ? metric.limit : null;
                    return (
                      <article className="rounded-xl border border-border bg-background p-4" data-meter={metric.key} key={metric.key}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
                            <Icon aria-hidden className="size-4 shrink-0" />
                            <h3 className="truncate font-medium text-foreground">{t(presentation.label)}</h3>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 font-medium text-[11px]',
                              metric.state === 'exceeded' && 'bg-destructive/10 text-destructive',
                              metric.state === 'approaching' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                              // Only approaching/exceeded may look like a warning; "No limit" is neutral (audit WORKSPACE-19).
                              (metric.state === 'unknown' || metric.state === 'unlimited' || metric.availability === 'partial') &&
                                'bg-muted text-muted-foreground',
                              metric.state === 'available' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                            )}
                          >
                            {metric.availability === 'partial' ? t('settings.usage.state.partial') : t(stateKeys[metric.state])}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                          <span
                            className="font-semibold text-2xl tabular-nums"
                            title={
                              metric.quantity !== null && metric.unit === 'byte'
                                ? t('settings.usage.exactBytes', { value: number(BigInt(metric.quantity)) })
                                : undefined
                            }
                          >
                            {metric.quantity === null ? '—' : formatQuantity(metric.quantity)}
                          </span>
                          {limit ? <span className="text-muted-foreground text-sm tabular-nums">/ {formatQuantity(limit)}</span> : null}
                        </div>
                        {limit && !unavailable ? (
                          <div
                            aria-label={t('settings.usage.progressLabel', { label: t(presentation.label) })}
                            aria-valuemax={100}
                            aria-valuemin={0}
                            aria-valuenow={Math.min(100, Math.round(percent))}
                            aria-valuetext={
                              share === null
                                ? t('settings.usage.progressValueNoShare', {
                                    used: formatQuantity(metric.quantity ?? '0'),
                                    limit: formatQuantity(limit),
                                  })
                                : t('settings.usage.progressValue', {
                                    used: formatQuantity(metric.quantity ?? '0'),
                                    limit: formatQuantity(limit),
                                    percent: number(share / 100, { style: 'percent', maximumFractionDigits: 1 }),
                                  })
                            }
                            className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                          >
                            <div
                              className={cn(
                                'h-full rounded-full',
                                metric.state === 'exceeded' ? 'bg-destructive' : metric.state === 'approaching' ? 'bg-amber-500' : 'bg-primary',
                              )}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        ) : null}
                        {unavailable ? (
                          <p className="mt-2 text-muted-foreground text-xs">{t(unavailableExplanationKey(metric.unavailableReason))}</p>
                        ) : null}
                      </article>
                    );
                  })}
            </div>
          </SettingsSection>
        );
      })}

      <p className="rounded-lg border border-border bg-muted/30 p-3 text-muted-foreground text-xs">{t('settings.usage.privacyNote')}</p>
    </div>
  );
}
