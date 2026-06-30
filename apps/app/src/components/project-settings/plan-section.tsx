import { Check } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@midad/design-system/lib/utils';

/** Per-site plan model. Billing isn't wired up yet — this is the framing so each
 *  website is self-contained (its own plan), ready to attach real plans/limits
 *  or a billing provider later. */
const TIERS = [
  {
    nameKey: 'settings.plan.tier.free.name',
    price: '$0',
    current: true,
    featureKeys: [
      'settings.plan.tier.free.feature.sites',
      'settings.plan.tier.free.feature.pages',
      'settings.plan.tier.free.feature.search',
      'settings.plan.tier.free.feature.languages',
      'settings.plan.tier.free.feature.support',
    ],
  },
  {
    nameKey: 'settings.plan.tier.pro.name',
    price: '—',
    featureKeys: [
      'settings.plan.tier.pro.feature.domain',
      'settings.plan.tier.pro.feature.badge',
      'settings.plan.tier.pro.feature.analytics',
      'settings.plan.tier.pro.feature.support',
    ],
  },
  {
    nameKey: 'settings.plan.tier.team.name',
    price: '—',
    featureKeys: [
      'settings.plan.tier.team.feature.members',
      'settings.plan.tier.team.feature.branches',
      'settings.plan.tier.team.feature.sso',
      'settings.plan.tier.team.feature.audit',
    ],
  },
] as const satisfies ReadonlyArray<{ nameKey: MessageKey; price: string; current?: boolean; featureKeys: readonly MessageKey[] }>;

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
      <div className="grid gap-4 sm:grid-cols-3">
        {TIERS.map((tier) => {
          const current = 'current' in tier && tier.current;
          return (
            <div key={tier.nameKey} className={cn('rounded-xl border p-4', current ? 'border-primary ring-1 ring-primary/30' : 'border-border')}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{t(tier.nameKey)}</span>
                {current ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary">{t('settings.plan.current')}</span>
                ) : null}
              </div>
              <div className="mt-1 font-semibold text-2xl">
                {tier.price}
                {tier.price !== '—' ? <span className="font-normal text-muted-foreground text-sm"> {t('settings.plan.perMonth')}</span> : null}
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {tier.featureKeys.map((featureKey) => (
                  <li key={featureKey} className="flex items-start gap-2 text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> {t(featureKey)}
                  </li>
                ))}
              </ul>
              {!current ? (
                <button
                  type="button"
                  disabled
                  className="mt-4 w-full cursor-not-allowed rounded-lg border border-border py-2 text-muted-foreground text-sm"
                >
                  {t('settings.plan.comingSoon')}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

