import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Meter } from '@nibleaf/design-system/components/ui/meter';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { SkeletonStatTile } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { useT } from '@nibleaf/i18n/react';
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
import {
  AVAILABILITY_TEXT,
  type MeterIcon,
  type MeterLike,
  meterPresentation,
  meterView,
  sharedMissingReason,
  USAGE_GROUPS,
  WEBSITE_HIDDEN_METERS,
} from '../model/usage';

const ICONS: Record<MeterIcon, LucideIcon> = {
  users: Users,
  hardDrive: HardDrive,
  globe: Globe2,
  files: Files,
  eye: Eye,
  search: Search,
  bot: Bot,
  arrowDown: ArrowDownToLine,
  arrowUp: ArrowUpFromLine,
  boxes: Boxes,
  database: Database,
  rocket: Rocket,
};

type UsageSummary = NonNullable<ReturnType<typeof useProjectUsage>['data']>;

/**
 * Website usage (§7, review #20): this website's pages, storage, traffic and
 * AI. No plan, no seats, no limits of its own: plan and billing live with the
 * organization, so the header points there (a link only for its Owner and
 * Admins).
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

/** "Plan and billing are managed by <Org> →": the link only for those who can open billing. */
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

const PLAN_TEXT: ReadonlyMap<string, 'settings.usage.plan.free'> = new Map([['free', 'settings.usage.plan.free']]);

/**
 * The meters, grouped, as the website's Usage page and the organization's
 * Usage & billing page show them. The page header, the period and whether the
 * figures are complete, then one section per group of meter tiles.
 */
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
  /** The organization's plan badge; omitted on website usage. */
  planKey?: string | null;
  notice?: ReactNode;
  hiddenMeters?: ReadonlySet<string>;
}) {
  const t = useT();
  const { date } = useFormatters();
  const visible = usage?.meters.filter((meter) => !hiddenMeters?.has(meter.key)) ?? [];
  // One reason for every missing number (metering off, say) is said once, here, not on each tile.
  const shared = sharedMissingReason(visible);
  return (
    <div aria-busy={isPending} className="flex flex-col gap-8">
      {isPending ? (
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
      ) : null}
      <PageHeader
        badge={
          planKey !== undefined ? (
            <StatusBadge tone="neutral">{t(PLAN_TEXT.get(planKey ?? '') ?? 'settings.usage.plan.unconfigured')}</StatusBadge>
          ) : undefined
        }
        description={description}
        title={title}
      />
      <div className="-mt-4 flex flex-col gap-2">
        {notice}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          <span>
            {usage
              ? t('settings.usage.period', {
                  start: date(usage.period.start),
                  end: date(new Date(new Date(usage.period.endExclusive).getTime() - 1)),
                })
              : t('settings.usage.period.loading')}
          </span>
          <span aria-live="polite">{usage?.availability ? t(AVAILABILITY_TEXT[usage.availability]) : null}</span>
        </p>
      </div>

      {shared ? <Callout tone="info">{t(shared)}</Callout> : null}

      {USAGE_GROUPS.map((group) => {
        const keys = group.keys.filter((key) => !hiddenMeters?.has(key));
        const meters = usage?.meters.filter((meter) => keys.includes(meter.key)) ?? [];
        return (
          <SettingsSection chrome="plain" description={t(group.description)} key={group.title} title={t(group.title)}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {isPending
                ? keys.map((key) => <SkeletonStatTile className="min-h-36" key={key} />)
                : meters.map((meter) => <MeterTile key={meter.key} meter={meter} sharedReason={shared} />)}
            </div>
          </SettingsSection>
        );
      })}

      <Callout tone="info">{t('settings.usage.privacyNote')}</Callout>
    </div>
  );
}

/** One meter: its name, state, amount (of the limit) and bar, or why the number is missing. */
function MeterTile({ meter, sharedReason }: { meter: MeterLike & { unit: string }; sharedReason: string | null }) {
  const t = useT();
  const { number } = useFormatters();
  const presentation = meterPresentation(meter.key);
  const Icon = ICONS[presentation.icon];
  const view = meterView(meter);
  const format = (value: string) => {
    if (meter.unit !== 'byte') return number(BigInt(value));
    return formatByteQuantity(value, {
      number,
      decimal: (whole, fraction) => t('settings.usage.decimal', { whole, fraction }),
      unit: (valueLabel, unit) =>
        t('settings.usage.unit', {
          value: valueLabel,
          unit: t(unit === 'gib' ? 'settings.usage.unit.gib' : unit === 'mib' ? 'settings.usage.unit.mib' : 'settings.usage.unit.byte'),
        }),
    });
  };
  const label = t(presentation.label);
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" data-meter={meter.key}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 font-medium text-sm">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </h3>
        <StatusBadge size="sm" tone={view.badge.tone}>
          {t(view.badge.label)}
        </StatusBadge>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span
          className="font-semibold text-2xl tabular-nums"
          title={
            meter.quantity !== null && meter.unit === 'byte' ? t('settings.usage.exactBytes', { value: number(BigInt(meter.quantity)) }) : undefined
          }
        >
          {meter.quantity === null ? '—' : format(meter.quantity)}
        </span>
        {view.limit ? <span className="text-muted-foreground text-sm tabular-nums">/ {format(view.limit)}</span> : null}
      </p>
      {view.bar && view.limit ? (
        <Meter
          label={t('settings.usage.progressLabel', { label })}
          tone={view.bar.tone}
          value={view.bar.value}
          valueText={
            view.share === null
              ? t('settings.usage.progressValueNoShare', { used: format(meter.quantity ?? '0'), limit: format(view.limit) })
              : t('settings.usage.progressValue', {
                  used: format(meter.quantity ?? '0'),
                  limit: format(view.limit),
                  percent: number(view.share / 100, { style: 'percent', maximumFractionDigits: 1 }),
                })
          }
          width={view.bar.width}
        />
      ) : null}
      {view.missing && view.missing !== sharedReason ? <p className="text-muted-foreground text-xs">{t(view.missing)}</p> : null}
    </article>
  );
}
