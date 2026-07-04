import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, BookOpen, Globe, Server, Unlock } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { BTN_DEFAULT, BTN_OUTLINE, btn, MarketingShell, PageHeader, SZ_LG } from '@/components/marketing';
import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { appHref, canonicalHref } from '@/lib/links';

export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      { title: 'About — Midad' },
      {
        name: 'description',
        content: 'Midad is an open-source, Arabic-first documentation platform for teams who want to own their content and their readers.',
      },
    ],
    links: [{ rel: 'canonical', href: canonicalHref('/about') }],
  }),
  component: AboutPage,
});

const VALUES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: MessageKey; body: MessageKey }[] = [
  { icon: Unlock, title: 'about.value.open.title', body: 'about.value.open.body' },
  { icon: BookOpen, title: 'about.value.own.title', body: 'about.value.own.body' },
  { icon: Globe, title: 'about.value.bilingual.title', body: 'about.value.bilingual.body' },
  { icon: Server, title: 'about.value.selfhost.title', body: 'about.value.selfhost.body' },
];

function AboutPage() {
  const t = useT();
  return (
    <MarketingShell>
      <PageHeader eyebrow={t('about.eyebrow')} title={t('about.title')} lead={t('about.lead')} />

      {/* Mission */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="font-semibold text-3xl tracking-tight">{t('about.mission.heading')}</h2>
        <div className="mt-6 space-y-5 text-lg text-muted-foreground leading-relaxed">
          <p>{t('about.mission.p1')}</p>
          <p>{t('about.mission.p2')}</p>
        </div>
      </section>

      {/* Values */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-semibold text-3xl tracking-tight">{t('about.values.heading')}</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value) => (
              <div key={value.title} className="rounded-xl border border-border bg-background p-6">
                <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                  <value.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-lg">{t(value.title)}</h3>
                <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t(value.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stack */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="font-semibold text-3xl tracking-tight">{t('about.stack.heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">{t('about.stack.body')}</p>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
          <div className="bg-dotgrid pointer-events-none absolute inset-0 opacity-[0.15]" aria-hidden="true" />
          <div className="relative">
            <h2 className="font-semibold text-3xl tracking-tight">{t('about.cta.title')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-background/75">{t('about.cta.body')}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={btn(BTN_DEFAULT, SZ_LG, 'group')} href={appHref('/sign-up')}>
                {t('cta.primary')}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
              </a>
              <a className={btn(BTN_OUTLINE, SZ_LG, 'border-background/25 bg-transparent text-background hover:bg-background/10')} href="/cloud">
                {t('nav.cloud')}
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
