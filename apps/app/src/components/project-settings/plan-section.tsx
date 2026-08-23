import { Badge } from '@nibleaf/design-system/components/ui/badge';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Check, Info } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { BETA_LIMITS } from '@/lib/beta-limits';
import { useFormatters } from '@/lib/format';

const FEATURES: MessageKey[] = [
  'settings.plan.selfHosted.feature.sites',
  'settings.plan.selfHosted.feature.pages',
  'settings.plan.selfHosted.feature.domains',
  'settings.plan.selfHosted.feature.languages',
  'settings.plan.selfHosted.feature.branches',
  'settings.plan.selfHosted.feature.analytics',
];

export function PlanSection({ project }: { project: Project }) {
  const t = useT();
  const { number: formatNumber } = useFormatters();
  // The pages feature quotes the shared beta limit so Plan and Usage never drift.
  const featureText = (key: MessageKey) =>
    key === 'settings.plan.selfHosted.feature.pages' ? t(key, { count: formatNumber(BETA_LIMITS.pages) }) : t(key);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-semibold text-xl tracking-tight">{t('settings.plan.title')}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {t('settings.plan.descriptionBefore')} <span className="font-medium text-foreground">{project.name}</span>
          {t('settings.plan.descriptionAfter')}
        </p>
      </div>

      {/* Billing is intentionally informational while Cloud is in free beta. */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Info className="size-5" />
        </span>
        <div className="leading-snug">
          <div className="font-medium text-sm">{t('settings.billing.notice.title')}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('settings.billing.notice.description')}</p>
        </div>
      </div>

      <section className="rounded-xl border border-primary bg-card p-5 ring-1 ring-primary/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-lg">{t('settings.plan.selfHosted.title')}</h3>
              <Badge variant="secondary">{t('settings.plan.current')}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground text-sm">{t('settings.plan.selfHosted.description')}</p>
          </div>
          <div className="text-end">
            <div className="font-semibold text-3xl">$0</div>
            <div className="text-muted-foreground text-sm">{t('settings.plan.selfHosted.price')}</div>
          </div>
        </div>

        <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
          {FEATURES.map((featureKey) => (
            <li key={featureKey} className="flex items-start gap-2 text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> {featureText(featureKey)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
