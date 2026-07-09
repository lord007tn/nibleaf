import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
import {
  ArrowRight,
  BarChart3,
  Check,
  Cloud,
  FileText,
  Globe2,
  PenLine,
  Rocket,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { GithubIcon } from '@/components/icons/brand';
import { GITHUB_STARS, GITHUB_URL } from '@/lib/links';

const buttonBase =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-4 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const primaryButton = `${buttonBase} bg-primary text-primary-foreground hover:bg-primary/90`;
const outlineButton = `${buttonBase} border border-border bg-background hover:bg-muted`;
/** Neutral bordered icon tile, matching the marketing site. */
const iconTile = 'grid place-items-center rounded-lg border border-border bg-background text-foreground';

const navLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#how', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: GITHUB_URL, label: 'Source', external: true },
];

const trustItems = ['Managed hosting', 'Custom domains', 'Markdown / MDX', 'Orama search', 'Analytics', 'S3 storage'];

const features: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { icon: FileText, title: 'Markdown workflow', body: 'Author pages, groups, callouts, and rich MDX blocks without fighting the editor.' },
  { icon: Search, title: 'Fast search', body: 'Published docs include full-text and fuzzy search, with bilingual Arabic-ready indexing.' },
  {
    icon: Workflow,
    title: 'Versioned publishing',
    body: 'Every publish snapshots your docs. Roll forward safely — readers never see a half-written page.',
  },
  { icon: Globe2, title: 'Custom domains', body: 'Connect production docs domains and keep every reader on your brand.' },
  { icon: BarChart3, title: 'Reader analytics', body: 'See page views, top content, and what people search for without a third-party tracker.' },
  { icon: Cloud, title: 'Managed cloud', body: 'Nibleaf runs the app, storage, queues, upgrades, and deployment path for you.' },
];

const steps: { icon: ComponentType<SVGProps<SVGSVGElement>>; kicker: string; title: string; body: string }[] = [
  {
    icon: PenLine,
    kicker: 'Step 1',
    title: 'Write in Markdown',
    body: 'Author pages in a focused editor with live preview, a page tree, and MDX components. No proprietary format — your content stays portable.',
  },
  {
    icon: Rocket,
    kicker: 'Step 2',
    title: 'Publish a version',
    body: 'Every publish snapshots your docs and rebuilds search. Roll forward safely; readers never see a half-written page.',
  },
  {
    icon: Share2,
    kicker: 'Step 3',
    title: 'Share your site',
    body: 'Connect a custom domain and ship a fast, searchable, bilingual site — hosted for you, or on your own servers.',
  },
];

const compareRows: { label: string; nibleaf: boolean; them: boolean }[] = [
  { label: 'Open source core', nibleaf: true, them: false },
  { label: 'Self-host on your infra', nibleaf: true, them: false },
  { label: 'Own your data & storage', nibleaf: true, them: false },
  { label: 'Markdown editor + live preview', nibleaf: true, them: true },
  { label: 'Built-in search', nibleaf: true, them: true },
  { label: 'Custom domains', nibleaf: true, them: true },
  { label: 'No per-seat lock-in', nibleaf: true, them: false },
];

const faqs: { q: string; a: string }[] = [
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

const cloudPlan = [
  'Hosted dashboard and docs sites',
  'Managed database, queues, and storage',
  'Automatic deploys and upgrades',
  'Custom domains and analytics',
];
const openPlan = ['Open-source core', 'Self-hosting path remains available', 'Portable Markdown content', 'AGPL-3.0 licensed'];

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Announcement />
      <header className="sticky top-0 z-40 border-border/70 border-b bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
          <a className="flex items-center gap-2 font-semibold text-lg tracking-tight" href="/">
            <NibleafMark className="size-8" />
            <NibleafWordmark />
          </a>
          <nav className="ms-8 hidden items-center gap-7 text-muted-foreground text-sm md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                className="transition-colors hover:text-foreground"
                href={link.href}
                {...(link.external ? { rel: 'noreferrer', target: '_blank' } : {})}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <a className={`${outlineButton} hidden h-9 px-3 text-muted-foreground sm:inline-flex`} href={GITHUB_URL} rel="noreferrer" target="_blank">
              <GithubIcon className="size-4" /> {GITHUB_STARS > 0 ? `${GITHUB_STARS} stars` : 'GitHub'}
            </a>
            <a className="hidden h-9 items-center rounded-md px-3 text-sm hover:bg-muted sm:inline-flex" href="/sign-in">
              Sign in
            </a>
            <a className={`${primaryButton} h-9 px-3`} href="/sign-up">
              Get started
            </a>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}

export function LandingPage() {
  return (
    <MarketingShell>
      <Hero />
      <TrustStrip />
      <Features />
      <HowItWorks />
      <Comparison />
      <PricingPreview />
      <Faq />
      <FinalCta />
    </MarketingShell>
  );
}

export function CloudPage() {
  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-border border-b">
        <GridBackground />
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Nibleaf Cloud</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Managed Nibleaf for production docs</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            Hosted dashboard, managed database and storage, automatic upgrades, custom domains, analytics, and Arabic-ready authoring.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a className={primaryButton} href="/sign-up">
              Start on Cloud <ArrowRight className="size-4" />
            </a>
            <a className={outlineButton} href="/pricing">
              View pricing
            </a>
          </div>
        </div>
      </section>
      <Features />
      <HowItWorks />
      <FinalCta />
    </MarketingShell>
  );
}

export function PricingPage() {
  return (
    <MarketingShell>
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Pricing</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Simple, honest pricing</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            Start on Nibleaf Cloud, with the open-source edition available when you need full infrastructure control.
          </p>
        </div>
      </section>
      <PricingCards />
      <Faq />
    </MarketingShell>
  );
}

function Announcement() {
  return (
    <a
      href="/cloud"
      className="group flex items-center justify-center gap-2 border-border/70 border-b bg-muted/60 px-4 py-2 text-center text-muted-foreground text-xs transition-colors hover:text-foreground"
    >
      <Sparkles className="size-3.5 text-primary" />
      <span>Nibleaf Cloud is live on nibleaf.com.</span>
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        Start writing <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-border border-b">
      <GridBackground />
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:py-24">
        <div>
          <a
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-medium text-muted-foreground text-xs shadow-xs transition-colors hover:text-foreground"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Nibleaf Cloud is live · open-source core
          </a>
          <h1 className="mt-6 text-balance font-semibold text-5xl tracking-tight sm:text-6xl">Beautiful docs, hosted for your team.</h1>
          <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            Nibleaf Cloud is the managed documentation platform for teams shipping polished docs. Write in Markdown, publish a fast searchable site,
            connect custom domains, and track what readers need without running servers.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className={`${primaryButton} group`} href="/sign-up">
              Start writing <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a className={outlineButton} href={GITHUB_URL} rel="noreferrer" target="_blank">
              <GithubIcon className="size-4" /> View source{GITHUB_STARS > 0 ? ` · ${GITHUB_STARS} stars` : ''}
            </a>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground text-sm">
            {['Managed hosting', 'Custom domains', 'Arabic-ready, RTL-first'].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" /> {item}
              </span>
            ))}
          </div>
        </div>
        <DocsPreview />
      </div>
    </section>
  );
}

function TrustStrip() {
  return (
    <div className="border-border border-b bg-card/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-3 px-6 py-6 text-sm">
        <span className="font-medium text-foreground/50 text-xs uppercase tracking-[0.16em]">Everything included</span>
        {trustItems.map((item) => (
          <span key={item} className="flex items-center gap-2 text-muted-foreground">
            <span className="hidden h-1 w-1 rounded-full bg-border sm:inline-block" aria-hidden="true" />
            <span className="font-mono text-foreground/70 text-xs">{item}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="features">
      <div className="max-w-2xl">
        <Eyebrow>Features</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Everything you need to ship docs</h2>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">A managed docs workflow with the freedom of an open-source core.</p>
      </div>
      <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="group bg-card p-7 transition-colors hover:bg-muted/40">
            <span
              className={`${iconTile} size-10 transition-colors group-hover:border-primary/30 group-hover:bg-primary group-hover:text-primary-foreground`}
            >
              <Icon className="size-5" />
            </span>
            <h3 className="mt-5 font-semibold text-base">{title}</h3>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-border border-y bg-card/40" id="how">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">From blank page to published in minutes</h2>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            A calm, predictable workflow — write in Markdown, publish a versioned snapshot, share a fast site.
          </p>
        </div>
        <ol className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="relative">
              {i < steps.length - 1 ? (
                <span className="absolute top-5 start-11 hidden h-px w-[calc(100%-1.5rem)] bg-border md:block" aria-hidden="true" />
              ) : null}
              <div className="flex items-center gap-3">
                <span className={`${iconTile} size-10 shrink-0`}>
                  <step.icon className="size-5" />
                </span>
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">{step.kicker}</span>
              </div>
              <h3 className="mt-5 font-semibold text-lg tracking-tight">{step.title}</h3>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Comparison() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24" id="compare">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>Comparison</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">A cloud docs platform without lock-in</h2>
        <p className="mt-4 text-lg text-muted-foreground">A polished managed experience, with source-available escape hatches when you need them.</p>
      </div>
      <div className="mt-12 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-4 border-border border-b bg-muted/40 px-6 py-3 font-medium text-sm">
          <span />
          <span className="flex items-center justify-center gap-1.5 text-center text-foreground">
            <NibleafMark className="size-4" /> Nibleaf
          </span>
          <span className="text-center text-muted-foreground">Other SaaS</span>
        </div>
        {compareRows.map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-4 border-border border-b px-6 py-3.5 text-sm last:border-0">
            <span>{row.label}</span>
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

function PricingPreview() {
  return (
    <section className="border-border border-y bg-card/35" id="pricing">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Start on Cloud</h2>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">Free beta for teams publishing production docs.</p>
          </div>
          <a className={outlineButton} href="/pricing">
            View full pricing <ArrowRight className="size-4" />
          </a>
        </div>
        <PricingCards />
      </div>
    </section>
  );
}

function PricingCards() {
  return (
    <section className="mx-auto grid max-w-4xl grid-cols-1 gap-6 px-6 py-14 sm:grid-cols-2">
      <Plan
        title="Cloud"
        price="Free beta"
        body="Managed Nibleaf for teams publishing production docs."
        features={cloudPlan}
        cta="Start on Cloud"
        href="/sign-up"
        featured
      />
      <Plan
        title="Open source"
        price="Free"
        body="For teams that need to inspect, extend, or run the core themselves."
        features={openPlan}
        cta="View source"
        href={GITHUB_URL}
      />
    </section>
  );
}

function Plan({
  title,
  price,
  body,
  features: items,
  cta,
  href,
  featured = false,
}: {
  title: string;
  price: string;
  body: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-8 ${featured ? 'border-primary/30 shadow-lg shadow-black/[0.06] ring-1 ring-primary/20' : 'border-border'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-lg">{title}</h3>
        {featured ? <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground text-xs">Popular</span> : null}
      </div>
      <p className="mt-4 font-semibold text-4xl tracking-tight">{price}</p>
      <p className="mt-1.5 text-muted-foreground text-sm">{body}</p>
      <ul className="mt-6 space-y-3 text-sm">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            {item}
          </li>
        ))}
      </ul>
      <a className={`${featured ? primaryButton : outlineButton} mt-7 w-full`} href={href}>
        {cta}
      </a>
    </div>
  );
}

function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24" id="faq">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Frequently asked</h2>
      </div>
      <div className="mt-12 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {faqs.map((item) => (
          <details key={item.q} className="group px-6 py-1 open:bg-muted/30">
            <summary className="flex list-none items-center justify-between gap-4 py-4 font-medium">
              {item.q}
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-4 text-muted-foreground text-sm leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-16 text-center text-background">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: 'radial-gradient(var(--background) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">Ship docs your users will love</h2>
          <p className="mx-auto mt-4 max-w-2xl text-background/70 leading-relaxed">
            Start on Nibleaf Cloud today, then keep the open-source core in reach when you need deeper control.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a className={`${primaryButton} group`} href="/sign-up">
              Get started free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              className={`${buttonBase} border border-background/25 text-background hover:bg-background/10`}
              href={GITHUB_URL}
              rel="noreferrer"
              target="_blank"
            >
              <GithubIcon className="size-4" /> View on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-border border-t bg-card/30">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <NibleafMark className="size-6" />
          <span className="font-medium">Nibleaf</span>
          <span className="text-muted-foreground">Managed docs hosting with an open-source core.</span>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          <a href="/cloud" className="hover:text-foreground">
            Cloud
          </a>
          <a href="/pricing" className="hover:text-foreground">
            Pricing
          </a>
          <a href={GITHUB_URL} rel="noreferrer" target="_blank" className="hover:text-foreground">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

function DocsPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/[0.08]">
      <div className="flex items-center gap-2 border-border border-b px-4 py-3">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ms-auto rounded bg-muted px-2 py-1 font-mono text-muted-foreground text-xs">docs.nibleaf.com</span>
      </div>
      <div className="grid min-h-[390px] grid-cols-[150px_1fr] overflow-hidden">
        <aside className="border-border border-e bg-muted/45 p-4">
          <div className="mb-4 flex items-center gap-2 text-sm">
            <NibleafMark className="size-5" />
            <span className="font-medium">Docs</span>
          </div>
          {['Overview', 'Guides', 'API', 'Changelog'].map((item, index) => (
            <div key={item} className={`mb-2 rounded-md px-2 py-1.5 text-sm ${index === 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
              {item}
            </div>
          ))}
        </aside>
        <div className="p-6">
          <div className="mb-5 rounded-md border border-border bg-background px-3 py-2 text-muted-foreground text-sm">Search or ask...</div>
          <div className="mb-3 h-4 w-24 rounded bg-muted" />
          <div className="mb-4 h-8 w-3/4 rounded bg-foreground/10" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-11/12 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
          </div>
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-3 flex items-center gap-2 font-medium text-sm">
              <ShieldCheck className="size-4 text-primary" /> Published and indexed
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              {[
                ['24', 'pages'],
                ['2', 'languages'],
                ['98%', 'search hit'],
              ].map(([n, label]) => (
                <div key={label} className="rounded-md bg-background p-3">
                  <div className="font-semibold text-lg">{n}</div>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-medium text-primary text-xs uppercase tracking-[0.18em]">
      <span className="h-px w-7 bg-primary/40" />
      {children}
    </span>
  );
}

function GridBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 opacity-60"
      style={{
        backgroundImage:
          'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
        backgroundSize: '44px 44px',
        maskImage: 'linear-gradient(to bottom, black, transparent 78%)',
      }}
    />
  );
}
