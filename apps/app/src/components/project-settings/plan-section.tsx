import { Badge } from '@midad/design-system/components/ui/badge';
import { Check } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

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
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-semibold text-xl tracking-tight">{t('settings.plan.title')}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {t('settings.plan.descriptionBefore')} <span className="font-medium text-foreground">{project.name}</span>
          {t('settings.plan.descriptionAfter')}
        </p>
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
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> {t(featureKey)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
