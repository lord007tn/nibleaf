import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Cloud, Layers, Sparkles } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { BTN_DEFAULT, BTN_OUTLINE, btn, Eyebrow, MarketingShell, SZ_DEFAULT, SZ_LG } from '@/components/marketing';
import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { appHref, canonicalHref } from '@/lib/links';
import { breadcrumbLd, hreflangLinks, pageMeta } from '@/lib/seo';

export const Route = createFileRoute('/cloud')({
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf Cloud — managed hosting',
      description:
        'Nibleaf Cloud is the managed documentation platform for teams that want Markdown authoring, search, analytics, and custom domains without running servers.',
      path: '/cloud',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/cloud') }, ...hreflangLinks('/cloud')],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Cloud', path: '/cloud' },
      ]),
    ],
  }),
  component: CloudPage,
});

const FEATURES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: MessageKey; body: MessageKey }[] = [
  { icon: Cloud, title: 'cloud.feature.managed.title', body: 'cloud.feature.managed.body' },
  { icon: Layers, title: 'cloud.feature.scale.title', body: 'cloud.feature.scale.body' },
  { icon: Sparkles, title: 'cloud.feature.same.title', body: 'cloud.feature.same.body' },
];

function CloudSignup() {
  const t = useT();

  return (
    <div className="flex flex-wrap justify-center gap-3">
      <a className={btn(BTN_DEFAULT, SZ_LG, 'group')} href={appHref('/sign-up')}>
        {t('cloud.form.submit')}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
      </a>
      <a className={btn(BTN_OUTLINE, SZ_LG)} href="/pricing">
        {t('nav.pricing')}
      </a>
    </div>
  );
}

function CloudPage() {
  const t = useT();
  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-border border-b">
        <div className="bg-dotgrid pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <div className="flex justify-center">
            <Eyebrow>{t('cloud.eyebrow')}</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">{t('cloud.title')}</h1>
          <p className="mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground leading-relaxed">{t('cloud.lead')}</p>
          <div className="mx-auto mt-8">
            <CloudSignup />
            <p className="mt-2.5 text-muted-foreground text-xs">{t('cloud.form.note')}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border bg-card p-6">
              <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                <feature.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold text-lg">{t(feature.title)}</h3>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t(feature.body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Self-host escape hatch */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card/40 px-8 py-12 text-center sm:flex-row sm:text-start">
          <div className="flex-1">
            <h2 className="font-semibold text-2xl tracking-tight">{t('cloud.selfhost.title')}</h2>
            <p className="mt-2 text-muted-foreground leading-relaxed">{t('cloud.selfhost.body')}</p>
          </div>
          <a className={btn(BTN_DEFAULT, SZ_DEFAULT, 'group shrink-0')} href="/self-hosting">
            {t('cloud.selfhost.cta')}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
