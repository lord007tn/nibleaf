import { Check } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { cn } from '@/lib/utils';

/** Per-site plan model. Billing isn't wired up yet — this is the framing so each
 *  website is self-contained (its own plan), ready to attach real plans/limits
 *  or a billing provider later. */
const TIERS = [
  {
    name: 'Free',
    price: '$0',
    current: true,
    features: ['1 published site', 'Unlimited pages', 'Hybrid search', 'Arabic + English', 'Community support'],
  },
  { name: 'Pro', price: '—', features: ['Custom domain', 'Remove Plume badge', 'Advanced analytics', 'Email support'] },
  { name: 'Team', price: '—', features: ['Per-site members & roles', 'Unlimited branches', 'SSO (planned)', 'Audit log (planned)'] },
] as const;

export function PlanSection({ project }: { project: Project }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-semibold text-xl tracking-tight">Plan</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Each site has its own plan. Billing isn't connected yet — this is the plan model for{' '}
          <span className="font-medium text-foreground">{project.name}</span>.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {TIERS.map((tier) => {
          const current = 'current' in tier && tier.current;
          return (
            <div key={tier.name} className={cn('rounded-xl border p-4', current ? 'border-primary ring-1 ring-primary/30' : 'border-border')}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{tier.name}</span>
                {current ? <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary">Current</span> : null}
              </div>
              <div className="mt-1 font-semibold text-2xl">
                {tier.price}
                {tier.price !== '—' ? <span className="font-normal text-muted-foreground text-sm"> /mo</span> : null}
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> {feature}
                  </li>
                ))}
              </ul>
              {!current ? (
                <button
                  type="button"
                  disabled
                  className="mt-4 w-full cursor-not-allowed rounded-lg border border-border py-2 text-muted-foreground text-sm"
                >
                  Coming soon
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
