import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, Boxes, Check, Search, Server, Sparkles, Workflow, X, Zap } from 'lucide-react';
import type { SVGProps } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
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

function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-border border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
        <a className="flex items-center gap-2 font-semibold text-lg tracking-tight" href="/">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">✎</span>
          Plume
        </a>
        <nav className="ms-8 hidden items-center gap-6 text-muted-foreground text-sm md:flex">
          <a className="transition-colors hover:text-foreground" href="#features">
            Features
          </a>
          <a className="transition-colors hover:text-foreground" href="#compare">
            vs Mintlify
          </a>
          <a className="transition-colors hover:text-foreground" href="#self-host">
            Self-host
          </a>
          <a className="transition-colors hover:text-foreground" href="#pricing">
            Pricing
          </a>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <a
            className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground sm:block"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
            aria-label="GitHub"
          >
            <Github className="size-4" />
          </a>
          <ThemeToggle />
          <a className="rounded-lg px-3 py-2 font-medium text-sm transition-colors hover:bg-muted" href={appHref()}>
            Sign in
          </a>
          <a
            className="rounded-lg bg-primary px-3.5 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
            href={appHref('/sign-up')}
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="-z-10 pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)]" />
      <div className="mx-auto max-w-4xl px-6 pt-24 pb-16 text-center">
        <a
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-medium text-muted-foreground text-xs"
          href={GITHUB_URL}
          rel="noreferrer"
          target="_blank"
        >
          <Sparkles className="size-3.5 text-primary" /> Open source · self-hostable · AGPL-3.0
        </a>
        <h1 className="mt-6 text-balance font-semibold text-5xl tracking-tight sm:text-6xl">
          Beautiful docs, <span className="text-primary">on your own infrastructure.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
          Plume is the open-source documentation platform. Write in Markdown, get a fast, searchable site with versioned publishing, custom domains,
          and analytics — self-hosted with one Docker command.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            href={appHref('/sign-up')}
          >
            Start writing — free
          </a>
          <a
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 font-medium transition-colors hover:bg-muted"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <Github className="size-4" /> Star on GitHub
          </a>
        </div>
        <p className="mt-5 font-mono text-muted-foreground text-xs">docker compose up -d</p>
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = ['Postgres', 'Hono', 'TanStack Start', 'BullMQ', 'Orama search', 'S3 storage'];
  return (
    <div className="border-border border-y bg-card/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-6 text-muted-foreground text-sm">
        <span className="font-medium text-foreground/70">Built on a stack you control:</span>
        {items.map((item) => (
          <span key={item} className="font-mono text-xs">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: Zap,
    title: 'Markdown editor',
    body: 'A focused editor with live preview, page tree, groups, and drag-to-reorder. Write fast, ship faster.',
  },
  { icon: Search, title: 'Hybrid search', body: 'Full-text + fuzzy search powered by Orama, built into every published site. Instant ⌘K results.' },
  {
    icon: Workflow,
    title: 'Versioned publishing',
    body: 'Every publish snapshots your docs. Roll forward safely; your live site never serves a half-written page.',
  },
  { icon: Boxes, title: 'Custom domains', body: 'Bring your own domain with guided DNS records and one-click verification.' },
  { icon: BarChart3, title: 'Analytics', body: 'See page views, unique visitors, top pages, and what people search for — no third-party tracker.' },
  {
    icon: Server,
    title: 'Self-host first',
    body: 'Postgres, a Redis-compatible cache, and S3-compatible storage. Runs anywhere Docker does. Your data stays yours.',
  },
];

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="features">
      <div className="max-w-2xl">
        <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">Everything you need to ship docs</h2>
        <p className="mt-3 text-lg text-muted-foreground">The polish of a hosted platform, with the freedom of open source.</p>
      </div>
      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-sm">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <feature.icon className="size-5" />
            </span>
            <h3 className="mt-4 font-semibold text-lg">{feature.title}</h3>
            <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{feature.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const COMPARE = [
  { label: 'Open source', plume: true, them: false },
  { label: 'Self-host on your infra', plume: true, them: false },
  { label: 'Own your data & storage', plume: true, them: false },
  { label: 'Markdown editor + live preview', plume: true, them: true },
  { label: 'Built-in search', plume: true, them: true },
  { label: 'Custom domains', plume: true, them: true },
  { label: 'No per-seat lock-in', plume: true, them: false },
];

function Comparison() {
  return (
    <section className="border-border border-y bg-card/40" id="compare">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h2 className="text-center font-semibold text-3xl tracking-tight sm:text-4xl">Plume vs hosted-only platforms</h2>
        <p className="mt-3 text-center text-lg text-muted-foreground">The same great authoring experience — without the lock-in.</p>
        <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-background">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-border border-b px-6 py-3 font-medium text-sm">
            <span />
            <span className="w-20 text-center text-primary">Plume</span>
            <span className="w-20 text-center text-muted-foreground">Hosted</span>
          </div>
          {COMPARE.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-border border-b px-6 py-3 text-sm last:border-0">
              <span>{row.label}</span>
              <span className="flex w-20 justify-center">
                {row.plume ? <Check className="size-4 text-primary" /> : <X className="size-4 text-muted-foreground" />}
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

function SelfHost() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="self-host">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div>
          <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">Self-host in 90 seconds</h2>
          <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
            Clone the repo, copy the env file, and bring the whole stack up with Docker Compose — app, API, worker, Postgres, cache, and object
            storage.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              'Postgres + Prisma migrations run automatically',
              'BullMQ worker builds & indexes your published docs',
              'Any S3-compatible storage (maxio, R2, S3, B2) for assets',
              'Create your account on first run — no demo credentials in production',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-[#0d1117] font-mono text-sm shadow-sm">
          <div className="flex items-center gap-1.5 border-white/10 border-b px-4 py-3">
            <span className="size-2.5 rounded-full bg-red-500/70" />
            <span className="size-2.5 rounded-full bg-amber-500/70" />
            <span className="size-2.5 rounded-full bg-green-500/70" />
            <span className="ms-3 text-white/40 text-xs">terminal</span>
          </div>
          <pre className="overflow-x-auto p-5 text-white/90 leading-relaxed">{`# clone & configure
git clone ${GITHUB_URL.replace('https://', '')}
cd plume && cp .env.example .env

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

const PLANS = [
  {
    name: 'Self-hosted',
    price: 'Free',
    tagline: 'Forever, on your own servers.',
    features: ['Unlimited sites & pages', 'Unlimited members', 'Search, analytics, custom domains', 'Community support'],
    cta: 'Get the source',
    href: GITHUB_URL,
  },
  {
    name: 'Cloud',
    price: '$0',
    tagline: 'Hosted by us — coming soon.',
    features: ['Everything in self-hosted', 'Managed Postgres & storage', 'Automatic upgrades', 'Priority support'],
    cta: 'Join the waitlist',
    href: appHref('/sign-up'),
    featured: true,
  },
];

function Pricing() {
  return (
    <section className="border-border border-y bg-card/40" id="pricing">
      <div className="mx-auto max-w-4xl px-6 py-24">
        <h2 className="text-center font-semibold text-3xl tracking-tight sm:text-4xl">Simple, honest pricing</h2>
        <p className="mt-3 text-center text-lg text-muted-foreground">Self-host for free. Or let us run it for you.</p>
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div key={plan.name} className={`rounded-2xl border bg-background p-7 ${plan.featured ? 'border-primary shadow-sm' : 'border-border'}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">{plan.name}</h3>
                {plan.featured ? <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">Popular</span> : null}
              </div>
              <div className="mt-3 font-semibold text-4xl tracking-tight">{plan.price}</div>
              <p className="mt-1 text-muted-foreground text-sm">{plan.tagline}</p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
                  </li>
                ))}
              </ul>
              <a
                className={`mt-6 block rounded-xl py-2.5 text-center font-medium transition-opacity hover:opacity-90 ${plan.featured ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
                href={plan.href}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  { q: 'Is Plume really free?', a: 'Yes. The self-hosted version is open source and free to run on your own infrastructure, forever.' },
  {
    q: 'What do I need to self-host?',
    a: 'Docker and Docker Compose. The stack includes Postgres, a Redis-compatible cache, and S3-compatible object storage — all wired up for you.',
  },
  {
    q: 'Can I use my own object storage?',
    a: 'Absolutely. Plume speaks the S3 API, so it works with MinIO, Cloudflare R2, AWS S3, or Backblaze B2.',
  },
  {
    q: 'How does search work?',
    a: 'Every published site is indexed with Orama for full-text and fuzzy search, served directly from your API — no external service.',
  },
];

function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="text-center font-semibold text-3xl tracking-tight sm:text-4xl">Frequently asked</h2>
      <div className="mt-10 space-y-3">
        {FAQS.map((item) => (
          <details key={item.q} className="group rounded-xl border border-border bg-card p-5">
            <summary className="flex list-none items-center justify-between font-medium">
              {item.q}
              <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <div className="overflow-hidden rounded-3xl bg-primary px-8 py-16 text-center text-primary-foreground">
        <h2 className="font-semibold text-3xl tracking-tight sm:text-4xl">Ship docs your users will love</h2>
        <p className="mx-auto mt-3 max-w-xl text-primary-foreground/85">Start in the cloud or self-host today. Either way, you own your content.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <a
            className="rounded-xl bg-primary-foreground px-5 py-3 font-medium text-primary transition-opacity hover:opacity-90"
            href={appHref('/sign-up')}
          >
            Get started free
          </a>
          <a
            className="rounded-xl border border-primary-foreground/30 px-5 py-3 font-medium transition-colors hover:bg-primary-foreground/10"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-muted-foreground text-sm sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-foreground text-background text-xs">✎</span>
          <span className="font-medium text-foreground">Plume</span>
          <span>— open-source docs</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5">
          <a className="transition-colors hover:text-foreground" href={GITHUB_URL} rel="noreferrer" target="_blank">
            GitHub
          </a>
          <a className="transition-colors hover:text-foreground" href={appHref()}>
            Dashboard
          </a>
          <a className="transition-colors hover:text-foreground" href="/terms">
            Terms
          </a>
          <a className="transition-colors hover:text-foreground" href="/privacy">
            Privacy
          </a>
          <a
            className="font-mono text-xs transition-colors hover:text-foreground"
            href={`${GITHUB_URL}/blob/main/LICENSE`}
            rel="noreferrer"
            target="_blank"
          >
            AGPL-3.0 licensed
          </a>
        </div>
      </div>
    </footer>
  );
}
