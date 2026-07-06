import { createFileRoute } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { BTN_DEFAULT, BTN_OUTLINE, btn, MarketingShell, PageHeader, SZ_DEFAULT } from '@/components/marketing';
import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { canonicalHref, GITHUB_URL } from '@/lib/links';
import { breadcrumbLd, hreflangLinks, pageMeta } from '@/lib/seo';

export const Route = createFileRoute('/pricing')({
  head: () => ({
    meta: pageMeta({
      title: 'Pricing — Midad',
      description: 'Self-host Midad for free, forever. Managed Midad Cloud is coming soon.',
      path: '/pricing',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/pricing') }, ...hreflangLinks('/pricing')],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Pricing', path: '/pricing' },
      ]),
    ],
  }),
  component: PricingPage,
});

const PLANS: {
  name: MessageKey;
  price: MessageKey;
  tagline: MessageKey;
  features: MessageKey[];
  cta: MessageKey;
  href: string;
  featured?: boolean;
}[] = [
  {
    name: 'pricing.selfHosted.name',
    price: 'pricing.selfHosted.price',
    tagline: 'pricing.selfHosted.tagline',
    features: [
      'pricing.selfHosted.feature.unlimited',
      'pricing.selfHosted.feature.members',
      'pricing.selfHosted.feature.search',
      'pricing.selfHosted.feature.community',
    ],
    cta: 'pricing.selfHosted.cta',
    href: GITHUB_URL,
  },
  {
    name: 'pricing.cloud.name',
    price: 'pricing.cloud.price',
    tagline: 'pricing.cloud.tagline',
    features: [
      'pricing.cloud.feature.everything',
      'pricing.cloud.feature.managed',
      'pricing.cloud.feature.upgrades',
      'pricing.cloud.feature.priority',
    ],
    cta: 'pricing.cloud.cta',
    href: '/cloud',
    featured: true,
  },
];

const FAQS: { q: MessageKey; a: MessageKey }[] = [
  { q: 'faq.free.q', a: 'faq.free.a' },
  { q: 'faq.selfHost.q', a: 'faq.selfHost.a' },
  { q: 'faq.storage.q', a: 'faq.storage.a' },
  { q: 'faq.search.q', a: 'faq.search.a' },
];

function PricingPage() {
  const t = useT();
  return (
    <MarketingShell>
      <PageHeader eyebrow={t('eyebrow.pricing')} title={t('pricing.heading')} lead={t('pricing.subhead')} />

      <section className="mx-auto max-w-4xl px-6 py-20">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-xl border bg-card p-7 transition-shadow ${plan.featured ? 'border-primary/50 shadow-lg shadow-black/5 ring-1 ring-primary/20' : 'border-border hover:shadow-sm'}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">{t(plan.name)}</h3>
                {plan.featured ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">{t('pricing.popular')}</span>
                ) : null}
              </div>
              <div className="mt-3 font-semibold text-4xl tracking-tight">{t(plan.price)}</div>
              <p className="mt-1 text-muted-foreground text-sm">{t(plan.tagline)}</p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t(f)}
                  </li>
                ))}
              </ul>
              <a className={btn(plan.featured ? BTN_DEFAULT : BTN_OUTLINE, SZ_DEFAULT, 'mt-6 w-full')} href={plan.href}>
                {t(plan.cta)}
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="border-border border-t bg-card/40">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-center font-semibold text-3xl tracking-tight">{t('faq.heading')}</h2>
          <div className="mt-10 space-y-3">
            {FAQS.map((item) => (
              <details key={item.q} className="group rounded-lg border border-border bg-background p-5 transition-colors hover:border-primary/30">
                <summary className="flex list-none items-center justify-between gap-4 font-medium">
                  {t(item.q)}
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{t(item.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
