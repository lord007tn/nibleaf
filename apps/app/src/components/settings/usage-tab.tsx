import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, FileText, HardDrive, Languages, type LucideIcon, Rocket, Search, TrendingUp, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project } from '@/hooks/api';
import { useProjectUsage } from '@/hooks/api';
import { BETA_LIMITS } from '@/lib/beta-limits';
import { useFormatters } from '@/lib/format';
import { SettingsSection } from './section';

const NEAR_LIMIT_RATIO = 0.9;

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * BYTES_PER_MB;

const round1 = (value: number) => Math.round(value * 10) / 10;

interface Metric {
  icon: LucideIcon;
  labelKey: MessageKey;
  used: number | null;
  /** null = surfaced but unmetered during the beta. */
  limit: number | null;
  /** Localized display overrides (e.g. "12.4 MB"); default is the formatted count. */
  usedDisplay?: string;
  limitDisplay?: string;
  /** Small caption on the card, e.g. "This month". */
  periodKey?: MessageKey;
  /** Extra context under the meter, e.g. "Latest v3". */
  detail?: string;
}

/** Mintlify-style usage meter: used / limit over a rounded progress track that
 *  turns amber with a hint once usage crosses 90% of the beta limit. */
function MetricCard({ metric }: { metric: Metric }) {
  const t = useT();
  const { number: formatNumber } = useFormatters();
  const Icon = metric.icon;
  const ratio = metric.limit && metric.used !== null ? metric.used / metric.limit : null;
  const nearLimit = ratio !== null && ratio >= NEAR_LIMIT_RATIO;
  const widthPct = ratio === null ? 0 : Math.min(100, Math.max(ratio > 0 ? 1 : 0, ratio * 100));

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Icon className="size-4" />
          <span>{t(metric.labelKey)}</span>
        </div>
        {metric.periodKey ? <span className="text-[11px] text-muted-foreground/70">{t(metric.periodKey)}</span> : null}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-semibold text-xl tabular-nums">{metric.used === null ? '—' : (metric.usedDisplay ?? formatNumber(metric.used))}</span>
        {metric.limit !== null ? (
          <span className="text-muted-foreground text-sm tabular-nums">/ {metric.limitDisplay ?? formatNumber(metric.limit)}</span>
        ) : (
          <span className="text-muted-foreground text-xs">{t('settings.usage.noLimit')}</span>
        )}
      </div>

      {metric.limit !== null && metric.used !== null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-[width]', nearLimit ? 'bg-amber-500' : 'bg-primary')}
            style={{ width: `${widthPct}%` }}
          />
        </div>
      ) : null}

      {nearLimit ? <p className="mt-1.5 text-amber-600 text-xs dark:text-amber-500">{t('settings.usage.nearLimit')}</p> : null}
      {metric.detail ? <p className="mt-1.5 text-muted-foreground text-xs">{metric.detail}</p> : null}
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {metrics.map((metric) => (
        <MetricCard key={metric.labelKey} metric={metric} />
      ))}
    </div>
  );
}

function MetricSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="mt-2.5 h-6 w-20 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-muted" />
    </div>
  );
}

export function UsageTab({ project }: { project: Project }) {
  const t = useT();
  const navigate = useNavigate();
  const { number: formatNumber } = useFormatters();
  const { data: usage, isLoading } = useProjectUsage(project.id);

  /** "12.4 MB" / "1 GB" with locale digits. */
  const formatBytes = (bytes: number): string =>
    bytes >= BYTES_PER_GB
      ? t('settings.usage.unit.gb', { value: formatNumber(round1(bytes / BYTES_PER_GB)) })
      : t('settings.usage.unit.mb', { value: formatNumber(round1(bytes / BYTES_PER_MB)) });

  const groups: Array<{ titleKey: MessageKey; descriptionKey: MessageKey; action?: ReactNode; metrics: Metric[] }> = usage
    ? [
        {
          titleKey: 'settings.usage.group.content',
          descriptionKey: 'settings.usage.group.content.description',
          metrics: [
            { icon: FileText, labelKey: 'settings.usage.pages', used: usage.pages, limit: BETA_LIMITS.pages },
            { icon: Languages, labelKey: 'settings.usage.languages', used: usage.languages, limit: BETA_LIMITS.languages },
            {
              icon: Rocket,
              labelKey: 'settings.usage.deployments',
              used: usage.deployments.thisMonth,
              limit: BETA_LIMITS.deploymentsPerMonth,
              periodKey: 'settings.usage.period.thisMonth',
              detail:
                usage.deployments.latestVersion !== null
                  ? t('settings.usage.latestVersion', { version: formatNumber(usage.deployments.latestVersion) })
                  : t('settings.usage.notPublished'),
            },
            {
              icon: HardDrive,
              labelKey: 'settings.usage.storage',
              used: usage.storage.bytes,
              limit: BETA_LIMITS.storageBytes,
              usedDisplay: formatBytes(usage.storage.bytes),
              limitDisplay: formatBytes(BETA_LIMITS.storageBytes),
            },
          ],
        },
        {
          titleKey: 'settings.usage.group.team',
          descriptionKey: 'settings.usage.group.team.description',
          metrics: [{ icon: Users, labelKey: 'settings.usage.members', used: usage.members, limit: BETA_LIMITS.members }],
        },
        {
          titleKey: 'settings.usage.group.traffic',
          descriptionKey: 'settings.usage.group.traffic.description',
          action: <span className="shrink-0 text-muted-foreground text-xs">{t('settings.usage.period.last30Days')}</span>,
          metrics: [
            {
              icon: TrendingUp,
              labelKey: 'settings.usage.pageviews',
              used: usage.traffic.pageviews30d,
              limit: BETA_LIMITS.pageviews30d,
              periodKey: 'settings.usage.period.last30Days',
            },
            {
              icon: Search,
              labelKey: 'settings.usage.searches',
              used: usage.traffic.searches30d,
              limit: BETA_LIMITS.searches30d,
              periodKey: 'settings.usage.period.last30Days',
            },
          ],
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-xl tracking-tight">{t('settings.usage.title')}</h2>
          <p className="mt-1 text-muted-foreground text-sm">{t('settings.usage.description')}</p>
        </div>
        {/* Plan pill — mirrors Mintlify's tier chip on their Usage page; links to the Plan section. */}
        <button
          className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card py-1.5 ps-3 pe-2 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() =>
            navigate({ to: '/app/projects/$projectId/settings', params: { projectId: project.id }, search: { section: 'plan' }, replace: true })
          }
          type="button"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          <span className="font-medium">{t('settings.plan.selfHosted.title')}</span>
          <span className="text-muted-foreground text-xs">{t('settings.usage.plan.free')}</span>
          <ChevronRight aria-hidden className="size-3.5 text-muted-foreground rtl:-scale-x-100" />
        </button>
      </div>

      {isLoading || !usage ? (
        <SettingsSection description={t('settings.usage.group.content.description')} title={t('settings.usage.group.content')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </div>
        </SettingsSection>
      ) : (
        groups.map((group) => (
          <SettingsSection action={group.action} description={t(group.descriptionKey)} key={group.titleKey} title={t(group.titleKey)}>
            <MetricGrid metrics={group.metrics} />
          </SettingsSection>
        ))
      )}
    </div>
  );
}
