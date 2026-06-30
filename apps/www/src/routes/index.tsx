import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, Boxes, Check, Languages, Search, Server, Sparkles, Workflow, X, Zap } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { MidadMark, MidadWordmark } from '@midad/design-system/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import type { MessageKey } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n';
import { appHref, GITHUB_URL } from '@/lib/links';

function Github(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 6.6 18 7 18 7c.7 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.3v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}

export const Route = createFileRoute('/')({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <main>
        <Hero />
        <TrustStrip />
        <Features />
        <Comparison />
        <SelfHost />
        <Pricing />
        <Faq />
        <CallToAction />
      </main>
      <SiteFooter />
    </div>
  );
}

function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <button
      aria-label={t('nav.language')}
      className="flex items-center gap-1.5 rounded-lg border border-border p-2 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      type="button"
    >
      <Languages className="size-4" />
      {t('nav.language')}
    </button>
  );
}

function SiteNav() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <header className="sticky top-0 z-40 border-border border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
        <a className="flex items-center gap-2 font-semibold text-lg tracking-tight" href="/">
          <MidadMark className="size-8" />
          <MidadWordmark script={locale === 'ar' ? 'arabic' : 'latin'} />
        </a>
        <nav className="ms-8 hidden items-center gap-6 text-muted-foreground text-sm md:flex">
          <a className="transition-colors hover:text-foreground" href="#features">
            {t('nav.features')}
          </a>
          <a className="transition-colors hover:text-foreground" href="#compare">
            {t('nav.compare')}
          </a>
          <a className="transition-colors hover:text-foreground" href="#self-host">
            {t('nav.selfHost')}
          </a>
          <a className="transition-colors hover:text-foreground" href="#pricing">
            {t('nav.pricing')}
          </a>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <a
            className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground sm:block"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
            aria-label={t('nav.github')}
          >
            <Github className="size-4" />
          </a>
          <LanguageToggle />
          <ThemeToggle />
          <a className="hidden rounded-lg px-3 py-2 font-medium text-sm transition-colors hover:bg-muted sm:inline-flex" href={appHref()}>
            {t('nav.signIn')}
          </a>
          <a
            className="whitespace-nowrap rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 sm:px-3.5"
            href={appHref('/sign-up')}
          >
            {t('nav.getStarted')}
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <section className="relative overflow-hidden border-border border-b">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pt-20 pb-16 lg:grid-cols-[1fr_420px]">
        <div className="text-center lg:text-start">
        <a
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-medium text-muted-foreground text-xs"
          href={GITHUB_URL}
          rel="noreferrer"
          target="_blank"
        >
          <Sparkles className="size-3.5 text-primary" /> {t('hero.badge')}
        </a>
        <h1 className="mt-6 text-balance font-semibold text-5xl tracking-tight sm:text-6xl">
          {t('hero.headlineLead')} <span className="text-primary">{t('hero.headlineAccent')}</span>
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed lg:mx-0">{t('hero.subhead')}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
          <a
            className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            href={appHref('/sign-up')}
          >
            {t('hero.ctaPrimary')}
          </a>
          <a
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 font-medium transition-colors hover:bg-muted"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <Github className="size-4" /> {t('hero.ctaSecondary')}
          </a>
        </div>
        <p className="mt-5 font-mono text-muted-foreground text-xs">{t('hero.terminal')}</p>
        </div>
        <div className="relative mx-auto w-full max-w-[420px]">
          <img
            alt={locale === 'ar' ? 'شعار مِداد' : 'Midad brand mark'}
            className="mx-auto h-auto w-full max-w-[360px]"
            height="1180"
            src="/brand/midad-logo-stacked.svg"
            width="1024"
          />
          <div className="mt-5 grid grid-cols-4 gap-2" aria-label={t('palette.label')}>
            {['#181612', '#8A4B2E', '#B96A3D', '#EEE4D3'].map((color) => (
              <span key={color} className="h-2 rounded-full" style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const t = useT();
  const items = ['Postgres', 'Hono', 'TanStack Start', 'BullMQ', 'Orama search', 'S3 storage'];
  return (
    <div className="border-border border-y bg-card/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-6 text-muted-foreground text-sm">
        <span className="font-medium text-foreground/70">{t('trust.prefix')}</span>
        {items.map((item) => (
          <span key={item} className="font-mono text-xs">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

const FEATURES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: MessageKey; body: MessageKey }[] = [
  { icon: Zap, title: 'features.editor.title', body: 'features.editor.body' },
  { icon: Search, title: 'features.search.title', body: 'features.search.body' },
  { icon: Workflow, title: 'features.publishing.title', body: 'features.publishing.body' },
  { icon: Boxes, title: 'features.domains.title', body: 'features.domains.body' },
  { icon: BarChart3, title: 'features.analytics.title', body: 'features.analytics.body' },
  { icon: Server, title: 'features.selfHost.title', body: 'features.selfHost.body' },
];

function Features() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="features">
      <div className="max-w-2xl">
        <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">{t('features.heading')}</h2>
        <p className="mt-3 text-lg text-muted-foreground">{t('features.subhead')}</p>
      </div>
      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-sm">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <feature.icon className="size-5" />
            </span>
            <h3 className="mt-4 font-semibold text-lg">{t(feature.title)}</h3>
            <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t(feature.body)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const COMPARE: { label: MessageKey; midad: boolean; them: boolean }[] = [
  { label: 'compare.row.openSource', midad: true, them: false },
  { label: 'compare.row.selfHost', midad: true, them: false },
  { label: 'compare.row.ownData', midad: true, them: false },
  { label: 'compare.row.editor', midad: true, them: true },
  { label: 'compare.row.search', midad: true, them: true },
  { label: 'compare.row.domains', midad: true, them: true },
  { label: 'compare.row.noLockIn', midad: true, them: false },
];

function Comparison() {
  const t = useT();
  return (
    <section className="border-border border-y bg-card/40" id="compare">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h2 className="text-center font-semibold text-3xl tracking-tight sm:text-4xl">{t('compare.heading')}</h2>
        <p className="mt-3 text-center text-lg text-muted-foreground">{t('compare.subhead')}</p>
        <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-background">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-border border-b px-6 py-3 font-medium text-sm">
            <span />
            <span className="w-20 text-center text-primary">{t('compare.colMidad')}</span>
            <span className="w-20 text-center text-muted-foreground">{t('compare.colHosted')}</span>
          </div>
          {COMPARE.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-border border-b px-6 py-3 text-sm last:border-0">
              <span>{t(row.label)}</span>
              <span className="flex w-20 justify-center">
                {row.midad ? <Check className="size-4 text-primary" /> : <X className="size-4 text-muted-foreground" />}
              </span>
              <span className="flex w-20 justify-center">
                {row.them ? <Check className="size-4 text-muted-foreground" /> : <X className="size-4 text-muted-foreground/50" />}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SELF_HOST_BULLETS: MessageKey[] = [
  'selfHost.bullet.migrations',
  'selfHost.bullet.worker',
  'selfHost.bullet.storage',
  'selfHost.bullet.account',
];

function SelfHost() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="self-host">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div>
          <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">{t('selfHost.heading')}</h2>
          <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{t('selfHost.body')}</p>
          <ul className="mt-6 space-y-3 text-sm">
            {SELF_HOST_BULLETS.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t(item)}
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-[#0d1117] font-mono text-sm shadow-sm" dir="ltr">
          <div className="flex items-center gap-1.5 border-white/10 border-b px-4 py-3">
            <span className="size-2.5 rounded-full bg-red-500/70" />
            <span className="size-2.5 rounded-full bg-amber-500/70" />
            <span className="size-2.5 rounded-full bg-green-500/70" />
            <span className="ms-3 text-white/40 text-xs">{t('selfHost.terminal.label')}</span>
          </div>
          <pre className="overflow-x-auto p-5 text-white/90 leading-relaxed">{`# clone & configure
git clone ${GITHUB_URL.replace('https://', '')}
cd midad && cp .env.example .env

# bring up the whole stack
docker compose up -d

# → app    http://localhost:4310
# → api    http://localhost:4311
# → docs   /sites/:projectId`}</pre>
        </div>
      </div>
    </section>
  );
}

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
    href: appHref('/sign-up'),
    featured: true,
  },
];

function Pricing() {
  const t = useT();
  return (
    <section className="border-border border-y bg-card/40" id="pricing">
      <div className="mx-auto max-w-4xl px-6 py-24">
        <h2 className="text-center font-semibold text-3xl tracking-tight sm:text-4xl">{t('pricing.heading')}</h2>
        <p className="mt-3 text-center text-lg text-muted-foreground">{t('pricing.subhead')}</p>
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div key={plan.name} className={`rounded-2xl border bg-background p-7 ${plan.featured ? 'border-primary shadow-sm' : 'border-border'}`}>
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
              <a
                className={`mt-6 block rounded-xl py-2.5 text-center font-medium transition-opacity hover:opacity-90 ${plan.featured ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
                href={plan.href}
              >
                {t(plan.cta)}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS: { q: MessageKey; a: MessageKey }[] = [
  { q: 'faq.free.q', a: 'faq.free.a' },
  { q: 'faq.selfHost.q', a: 'faq.selfHost.a' },
  { q: 'faq.storage.q', a: 'faq.storage.a' },
  { q: 'faq.search.q', a: 'faq.search.a' },
];

function Faq() {
  const t = useT();
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="text-center font-semibold text-3xl tracking-tight sm:text-4xl">{t('faq.heading')}</h2>
      <div className="mt-10 space-y-3">
        {FAQS.map((item) => (
          <details key={item.q} className="group rounded-xl border border-border bg-card p-5">
            <summary className="flex list-none items-center justify-between font-medium">
              {t(item.q)}
              <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{t(item.a)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CallToAction() {
  const t = useT();
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <div className="overflow-hidden rounded-3xl bg-primary px-8 py-16 text-center text-primary-foreground">
        <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">{t('cta.heading')}</h2>
        <p className="mx-auto mt-3 max-w-xl text-primary-foreground/85">{t('cta.body')}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <a
            className="rounded-xl bg-primary-foreground px-5 py-3 font-medium text-primary transition-opacity hover:opacity-90"
            href={appHref('/sign-up')}
          >
            {t('cta.primary')}
          </a>
          <a
            className="rounded-xl border border-primary-foreground/30 px-5 py-3 font-medium transition-colors hover:bg-primary-foreground/10"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            {t('cta.secondary')}
          </a>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-muted-foreground text-sm sm:flex-row">
        <div className="flex items-center gap-2">
          <MidadMark className="size-6" />
          <MidadWordmark className="font-medium text-foreground" script={locale === 'ar' ? 'arabic' : 'latin'} />
          <span>{t('footer.tagline')}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5">
          <a className="transition-colors hover:text-foreground" href={GITHUB_URL} rel="noreferrer" target="_blank">
            {t('footer.github')}
          </a>
          <a className="transition-colors hover:text-foreground" href={appHref()}>
            {t('footer.dashboard')}
          </a>
          <a className="transition-colors hover:text-foreground" href="/terms">
            {t('footer.terms')}
          </a>
          <a className="transition-colors hover:text-foreground" href="/privacy">
            {t('footer.privacy')}
          </a>
          <a
            className="font-mono text-xs transition-colors hover:text-foreground"
            href={`${GITHUB_URL}/blob/main/LICENSE`}
            rel="noreferrer"
            target="_blank"
          >
            {t('footer.license')}
          </a>
        </div>
      </div>
    </footer>
  );
}

