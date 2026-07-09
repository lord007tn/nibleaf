import { NibleafMark } from '@nibleaf/design-system/brand';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, BarChart3, Boxes, Check, Cloud, FileText, Info, PenLine, Rocket, Search, Share2, Workflow, X, Zap } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { BTN_DEFAULT, BTN_OUTLINE, btn, Eyebrow, Github, MarketingShell, SZ_DEFAULT, SZ_LG } from '@/components/marketing';
import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { appHref, canonicalHref, GITHUB_STARS, GITHUB_URL } from '@/lib/links';
import { hreflangLinks } from '@/lib/seo';

const HOME_FAQS: { q: string; a: string }[] = [
  {
    q: 'Can I use Nibleaf Cloud now?',
    a: 'Yes. Nibleaf Cloud is live for teams that want managed docs hosting, sign-in, publishing, search, and custom domains.',
  },
  {
    q: 'Is Nibleaf still open source?',
    a: 'Yes. The core platform remains open source, and self-hosting is still available for teams that want to run their own infrastructure.',
  },
  {
    q: 'Can I use my own object storage?',
    a: 'Absolutely. Nibleaf speaks the S3 API, so it works with maxio, Cloudflare R2, AWS S3, or Backblaze B2.',
  },
  {
    q: 'How does search work?',
    a: 'Every published site is indexed with Orama for full-text and fuzzy search, served directly from your API — no external service.',
  },
];

export const Route = createFileRoute('/')({
  head: () => ({
    links: [{ rel: 'canonical', href: canonicalHref('/') }, ...hreflangLinks('/')],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: HOME_FAQS.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        }),
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <MarketingShell>
      <Hero />
      <CapabilityStrip />
      <Features />
      <HowItWorks />
      <Comparison />
      <SelfHost />
      <Pricing />
      <Faq />
      <CallToAction />
    </MarketingShell>
  );
}

function Hero() {
  const t = useT();
  const chips: MessageKey[] = ['hero.chip.oneCommand', 'hero.chip.ownData', 'hero.chip.bilingual'];
  return (
    <section className="relative overflow-hidden border-border border-b">
      {/* faint neutral texture — no colour wash */}
      <div className="bg-dotgrid pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 pt-16 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,530px)] lg:pt-24">
        <div className="animate-rise text-center lg:text-start">
          <a
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-medium text-muted-foreground text-xs shadow-xs transition-colors hover:text-foreground"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            {t('hero.badge')}
          </a>
          <h1 className="mt-6 text-balance font-semibold text-[2.75rem] leading-[1.03] tracking-tight sm:text-6xl">
            {t('hero.headlineLead')} <span className="text-gradient-brand">{t('hero.headlineAccent')}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-muted-foreground leading-relaxed lg:mx-0">{t('hero.subhead')}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <a className={btn(BTN_DEFAULT, SZ_LG, 'group')} href={appHref('/sign-up')}>
              {t('hero.ctaPrimary')}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
            </a>
            <a className={btn(BTN_OUTLINE, SZ_LG)} href={GITHUB_URL} rel="noreferrer" target="_blank">
              <Github className="size-4" /> {t('hero.ctaSecondary')}
              {GITHUB_STARS > 0 ? ` · ${GITHUB_STARS} stars` : ''}
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-muted-foreground text-sm lg:justify-start">
            {chips.map((chip) => (
              <span key={chip} className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" /> {t(chip)}
              </span>
            ))}
          </div>
        </div>
        <div className="animate-rise [animation-delay:120ms]">
          <DocsMock />
        </div>
      </div>
    </section>
  );
}

/** A stylised docs-site window used as the hero product visual. LTR-locked. */
function DocsMock() {
  const t = useT();
  return (
    <div className="relative mx-auto w-full max-w-[530px]" dir="ltr" aria-hidden="true">
      {/* floating status chip for depth */}
      <div className="absolute -top-3 end-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-medium text-xs shadow-md">
        <span className="size-2 rounded-full bg-emerald-500" /> {t('hero.mock.badge')}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/[0.06] ring-1 ring-black/5">
        {/* title bar */}
        <div className="flex items-center gap-2 border-border border-b bg-muted/50 px-4 py-3">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
          </span>
          <div className="ms-2 flex flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
            <Search className="size-3" /> {t('hero.mock.search')}
            <kbd className="ms-auto rounded border border-border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
          </div>
          <NibleafMark className="size-5" />
        </div>
        {/* body */}
        <div className="grid grid-cols-[116px_1fr] text-[11px]">
          {/* sidebar */}
          <nav className="space-y-3 border-border border-e bg-muted/30 p-3">
            <p className="font-semibold text-[9px] text-muted-foreground uppercase tracking-wider">Get started</p>
            <ul className="space-y-1.5">
              <li className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">Introduction</li>
              <li className="px-2 py-1 text-muted-foreground">Quickstart</li>
              <li className="px-2 py-1 text-muted-foreground">Installation</li>
            </ul>
            <p className="pt-1 font-semibold text-[9px] text-muted-foreground uppercase tracking-wider">Guides</p>
            <ul className="space-y-1.5">
              <li className="px-2 py-1 text-muted-foreground">Authoring</li>
              <li className="px-2 py-1 text-muted-foreground">Search</li>
              <li className="px-2 py-1 text-muted-foreground">Deploy</li>
            </ul>
          </nav>
          {/* content */}
          <div className="space-y-3 p-4">
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              Docs <span className="opacity-50">/</span> Get started
            </p>
            <p className="font-semibold text-foreground text-lg tracking-tight">Introduction</p>
            <div className="space-y-1.5">
              <span className="block h-2 w-full rounded bg-muted" />
              <span className="block h-2 w-[85%] rounded bg-muted" />
            </div>
            {/* callout */}
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="space-y-1">
                <span className="block h-1.5 w-24 rounded bg-primary/30" />
                <span className="block h-1.5 w-32 rounded bg-primary/20" />
              </div>
            </div>
            {/* code block */}
            <div className="overflow-hidden rounded-lg border border-border bg-[#0d1117]">
              <div className="flex items-center gap-1.5 border-white/10 border-b px-2.5 py-1.5">
                <FileText className="size-3 text-white/40" />
                <span className="font-mono text-[9px] text-white/40">config.mdx</span>
              </div>
              <div className="space-y-1.5 p-2.5 font-mono text-[10px]">
                <span className="block h-1.5 w-20 rounded bg-white/40" />
                <span className="block h-1.5 w-32 rounded bg-white/25" />
                <span className="block h-1.5 w-24 rounded bg-white/15" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Quiet hairline strip reinforcing what ships in the box. */
function CapabilityStrip() {
  const t = useT();
  const items = ['Managed hosting', 'Custom domains', 'Markdown / MDX', 'Orama search', 'Analytics', 'S3 storage'];
  return (
    <div className="border-border border-b bg-card/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-3 px-6 py-6 text-sm">
        <span className="font-medium text-foreground/50 text-xs uppercase tracking-[0.16em]">{t('trust.prefix')}</span>
        {items.map((item) => (
          <span key={item} className="flex items-center gap-2 text-muted-foreground">
            <span className="hidden h-1 w-1 rounded-full bg-border sm:inline-block" aria-hidden="true" />
            <span className="font-mono text-foreground/70 text-xs">{item}</span>
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
  { icon: Cloud, title: 'features.selfHost.title', body: 'features.selfHost.body' },
];

function Features() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="features">
      <div className="max-w-2xl">
        <Eyebrow>{t('eyebrow.features')}</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">{t('features.heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('features.subhead')}</p>
      </div>
      <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="group relative bg-card p-7 transition-colors hover:bg-muted/40">
            <span className="grid size-10 place-items-center rounded-lg border border-border bg-background text-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary group-hover:text-primary-foreground">
              <feature.icon className="size-5" />
            </span>
            <h3 className="mt-5 font-semibold text-base">{t(feature.title)}</h3>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{t(feature.body)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const STEPS: { icon: ComponentType<SVGProps<SVGSVGElement>>; kicker: MessageKey; title: MessageKey; body: MessageKey }[] = [
  { icon: PenLine, kicker: 'how.step1.kicker', title: 'how.step1.title', body: 'how.step1.body' },
  { icon: Rocket, kicker: 'how.step2.kicker', title: 'how.step2.title', body: 'how.step2.body' },
  { icon: Share2, kicker: 'how.step3.kicker', title: 'how.step3.title', body: 'how.step3.body' },
];

function HowItWorks() {
  const t = useT();
  return (
    <section className="border-border border-y bg-card/40" id="how">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <Eyebrow>{t('eyebrow.how')}</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">{t('how.heading')}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t('how.subhead')}</p>
        </div>
        <ol className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative">
              {/* connector hairline (desktop) */}
              {i < STEPS.length - 1 ? (
                <span className="absolute top-5 start-11 hidden h-px w-[calc(100%-1.5rem)] bg-border md:block" aria-hidden="true" />
              ) : null}
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground">
                  <step.icon className="size-5" />
                </span>
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">{t(step.kicker)}</span>
              </div>
              <h3 className="mt-5 font-semibold text-lg tracking-tight">{t(step.title)}</h3>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{t(step.body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const COMPARE: { label: MessageKey; nibleaf: boolean; them: boolean }[] = [
  { label: 'compare.row.openSource', nibleaf: true, them: false },
  { label: 'compare.row.selfHost', nibleaf: true, them: false },
  { label: 'compare.row.ownData', nibleaf: true, them: false },
  { label: 'compare.row.editor', nibleaf: true, them: true },
  { label: 'compare.row.search', nibleaf: true, them: true },
  { label: 'compare.row.domains', nibleaf: true, them: true },
  { label: 'compare.row.noLockIn', nibleaf: true, them: false },
];

function Comparison() {
  const t = useT();
  return (
    <section className="mx-auto max-w-3xl px-6 py-24" id="compare">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>{t('eyebrow.compare')}</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">{t('compare.heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('compare.subhead')}</p>
      </div>
      <div className="mt-12 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-4 border-border border-b bg-muted/40 px-6 py-3 font-medium text-sm">
          <span />
          <span className="flex items-center justify-center gap-1.5 text-center text-foreground">
            <NibleafMark className="size-4" />
            {t('compare.colNibleaf')}
          </span>
          <span className="text-center text-muted-foreground">{t('compare.colHosted')}</span>
        </div>
        {COMPARE.map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-4 border-border border-b px-6 py-3.5 text-sm last:border-0">
            <span>{t(row.label)}</span>
            <span className="flex h-full items-center justify-center bg-primary/5">
              {row.nibleaf ? <Check className="size-4 text-primary" /> : <X className="size-4 text-muted-foreground/50" />}
            </span>
            <span className="flex justify-center">
              {row.them ? <Check className="size-4 text-muted-foreground" /> : <X className="size-4 text-muted-foreground/40" />}
            </span>
          </div>
        ))}
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
    <section className="border-border border-y bg-card/40" id="self-host">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-24 lg:grid-cols-2">
        <div>
          <Eyebrow>{t('eyebrow.selfHost')}</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">{t('selfHost.heading')}</h2>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">{t('selfHost.body')}</p>
          <ul className="mt-7 space-y-3.5 text-sm">
            {SELF_HOST_BULLETS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground">
                  <Check className="size-3" />
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
          <a className={btn(BTN_OUTLINE, SZ_DEFAULT, 'mt-8')} href="/self-hosting">
            {t('eyebrow.selfHost')}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </a>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-[#0d1117] font-mono text-sm shadow-xl shadow-black/[0.06]" dir="ltr">
          <div className="flex items-center gap-1.5 border-white/10 border-b px-4 py-3">
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="ms-3 text-white/40 text-xs">{t('selfHost.terminal.label')}</span>
          </div>
          <pre className="overflow-x-auto p-5 text-white/90 leading-relaxed">{`# clone & configure
git clone ${GITHUB_URL.replace('https://', '')}
cd nibleaf && cp .env.example .env

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
];

function Pricing() {
  const t = useT();
  return (
    <section className="mx-auto max-w-4xl px-6 py-24" id="pricing">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>{t('eyebrow.pricing')}</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">{t('pricing.heading')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('pricing.subhead')}</p>
      </div>
      <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`relative rounded-xl border bg-card p-8 transition-shadow ${
              plan.featured ? 'border-primary/30 shadow-lg shadow-black/[0.06] ring-1 ring-primary/20' : 'border-border hover:shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">{t(plan.name)}</h3>
              {plan.featured ? (
                <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground text-xs">{t('pricing.popular')}</span>
              ) : null}
            </div>
            <div className="mt-4 font-semibold text-4xl tracking-tight">{t(plan.price)}</div>
            <p className="mt-1.5 text-muted-foreground text-sm">{t(plan.tagline)}</p>
            <ul className="mt-6 space-y-3 text-sm">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t(f)}
                </li>
              ))}
            </ul>
            <a className={btn(plan.featured ? BTN_DEFAULT : BTN_OUTLINE, SZ_DEFAULT, 'mt-7 w-full')} href={plan.href}>
              {t(plan.cta)}
            </a>
          </div>
        ))}
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
    <section className="mx-auto max-w-3xl px-6 py-24" id="faq">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>{t('eyebrow.faq')}</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">{t('faq.heading')}</h2>
      </div>
      <div className="mt-12 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {FAQS.map((item) => (
          <details key={item.q} className="group px-6 py-1 open:bg-muted/30">
            <summary className="flex list-none items-center justify-between gap-4 py-4 font-medium">
              {t(item.q)}
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-4 text-muted-foreground text-sm leading-relaxed">{t(item.a)}</p>
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
      <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-16 text-center text-background">
        <div className="bg-dotgrid pointer-events-none absolute inset-0 opacity-[0.15]" aria-hidden="true" />
        <div className="relative">
          <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">{t('cta.heading')}</h2>
          <p className="mx-auto mt-4 max-w-xl text-background/70">{t('cta.body')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a className={btn(BTN_DEFAULT, SZ_LG, 'group')} href={appHref('/sign-up')}>
              {t('cta.primary')}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
            </a>
            <a
              className={btn(SZ_LG, 'border-background/25 text-background hover:bg-background/10')}
              href={GITHUB_URL}
              rel="noreferrer"
              target="_blank"
            >
              <Github className="size-4" /> {t('cta.secondary')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
