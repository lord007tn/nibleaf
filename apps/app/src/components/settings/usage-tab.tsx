import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { LimitState, UsageAvailability } from '@nibleaf/usage';
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

function UsageSkeleton() {
  return <div aria-hidden className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" />;
}

export function UsageTab({ project }: { project: Project }) {
  const t = useT();
  const { date, number } = useFormatters();
  const { data: usage, isLoading } = useProjectUsage(project.id);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-xl tracking-tight">{t('settings.usage.title')}</h2>
            <p className="mt-1 max-w-2xl text-muted-foreground text-sm">{t('settings.usage.description')}</p>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1.5 font-medium text-sm">
            {t(planLabelKeys.get(usage?.plan.key ?? '') ?? 'settings.usage.plan.unconfigured')}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-t pt-4 text-muted-foreground text-xs">
          <span>
            {usage
              ? t('settings.usage.period', {
                  start: date(usage.period.start),
                  end: date(new Date(new Date(usage.period.endExclusive).getTime() - 1)),
                })
              : t('settings.usage.period.loading')}
          </span>
          <span aria-live="polite">{usage ? t(availabilityKeys[usage.availability]) : null}</span>
        </div>
      </header>

      {groups.map((group) => {
        const metrics = usage?.meters.filter((metric) => group.keys.includes(metric.key)) ?? [];
        return (
          <SettingsSection description={t(group.description)} key={group.title} title={t(group.title)}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {isLoading || !usage
                ? group.keys.slice(0, 3).map((key) => <UsageSkeleton key={key} />)
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
                    const progress = metric.ratio === null ? 0 : Math.min(100, Math.max(metric.ratio > 0 ? 2 : 0, metric.ratio * 100));
                    const unavailable = metric.quantity === null;
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
                              (metric.state === 'unknown' || metric.availability === 'partial') && 'bg-muted text-muted-foreground',
                              (metric.state === 'available' || metric.state === 'unlimited') && 'bg-primary/10 text-primary',
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
                          {metric.limit ? <span className="text-muted-foreground text-sm tabular-nums">/ {formatQuantity(metric.limit)}</span> : null}
                        </div>
                        {metric.limit && !unavailable ? (
                          <div
                            aria-label={t('settings.usage.progressLabel', { label: t(presentation.label) })}
                            aria-valuemax={100}
                            aria-valuemin={0}
                            aria-valuenow={Math.round(progress)}
                            className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                          >
                            <div
                              className={cn(
                                'h-full rounded-full',
                                metric.state === 'exceeded' ? 'bg-destructive' : metric.state === 'approaching' ? 'bg-amber-500' : 'bg-primary',
                              )}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        ) : null}
                        {unavailable ? <p className="mt-2 text-muted-foreground text-xs">{t('settings.usage.unknownExplanation')}</p> : null}
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
