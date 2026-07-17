import { ArrowRight, Check, Cloud, HandCoins, Scale, Server, ShieldCheck } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { CopyCommand, Eyebrow, faqs, invertedOutlineButton, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import { GithubIcon } from '@/components/icons/brand';
import { GITHUB_URL } from '@/lib/links';

/** A comparison cell: `true` renders a check, a string renders as explanatory text. */
type Cell = true | string;

const featureGroups: { title: string; rows: { label: string; cloud: Cell; self: Cell }[] }[] = [
  {
    title: 'Authoring',
    rows: [
      { label: 'Notion-style editor over plain Markdown', cloud: true, self: true },
      { label: 'MDX components (callouts, tabs, code groups)', cloud: true, self: true },
      { label: 'Anchored review comments on blocks', cloud: true, self: true },
      { label: 'Unlimited sites, pages, and members', cloud: 'Fair use during beta', self: true },
    ],
  },
  {
    title: 'Publishing',
    rows: [
      { label: 'Versioned, immutable publishes', cloud: true, self: true },
      { label: 'Custom domains with guided DNS', cloud: true, self: true },
      { label: 'Wildcard project subdomains', cloud: true, self: true },
    ],
  },
  {
    title: 'Search, SEO & analytics',
    rows: [
      { label: 'Built-in full-text + fuzzy search (Orama)', cloud: true, self: true },
      { label: 'SSR, canonicals, JSON-LD, sitemaps, hreflang', cloud: true, self: true },
      { label: 'First-party analytics (no trackers)', cloud: true, self: true },
    ],
  },
  {
    title: 'Languages',
    rows: [
      { label: 'English + Arabic, full RTL', cloud: true, self: true },
      { label: 'Per-language page trees', cloud: true, self: true },
    ],
  },
  {
    title: 'Infrastructure',
    rows: [
      { label: 'Hosting', cloud: 'Managed for you', self: 'Your servers' },
      { label: 'Database & storage', cloud: 'Managed Postgres + storage', self: 'Your Postgres, any S3-compatible store' },
      { label: 'Upgrades', cloud: 'Automatic', self: 'Pull the new image; migrations run themselves' },
      { label: 'Data ownership', cloud: 'Exportable Markdown, always', self: 'Everything stays on your infra' },
      { label: 'Support', cloud: 'support@nibleaf.com', self: 'GitHub issues & community' },
    ],
  },
];

const betaPromises: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  {
    icon: HandCoins,
    title: 'No credit card, no billing code',
    body: 'There is nothing to cancel and no trial clock. Sign up, write, publish — the beta is simply free.',
  },
  {
    icon: Scale,
    title: 'Fair use, not hard limits',
    body: 'No page caps or seat counts. If a workspace is unusually heavy on resources, we reach out before anything changes.',
  },
  {
    icon: ShieldCheck,
    title: 'Generous notice before paid plans',
    body: 'When paid cloud plans arrive, beta workspaces get advance notice and preferential treatment. Self-hosting stays free forever.',
  },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return <Check aria-label="Included" className="mx-auto size-4 text-primary" />;
  }
  return <span className="block text-center text-muted-foreground text-xs leading-snug">{value}</span>;
}

export function PricingPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      {/* Header */}
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Pricing</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Free while in beta. Free forever self-hosted.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            One open-source platform, two ways to run it. No feature gates, no per-seat pricing, no credit card.
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="mx-auto grid max-w-4xl grid-cols-1 gap-6 px-6 py-16 sm:grid-cols-2">
        <div className="flex flex-col rounded-xl border border-primary/30 bg-card p-8 shadow-lg shadow-black/[0.06] ring-1 ring-primary/20">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-lg">
              <Cloud className="size-5 text-primary" /> Cloud
            </h2>
            <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground text-xs">Fastest start</span>
          </div>
          <p className="mt-4 font-semibold text-4xl tracking-tight">$0</p>
          <p className="mt-1 text-muted-foreground text-sm">free during beta — no credit card</p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              'Hosted dashboard and docs sites',
              'Managed database, queues, and storage',
              'Automatic deploys and upgrades',
              'Custom domains and analytics',
              'Priority treatment when paid plans arrive',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
          <a className={`${primaryButton} mt-7`} href="/sign-up">
            Start on Cloud <ArrowRight className="size-4" />
          </a>
          <p className="mt-3 text-center text-muted-foreground text-xs">Live in about 60 seconds.</p>
        </div>
        <div className="flex flex-col rounded-xl border border-border bg-card p-8">
          <h2 className="flex items-center gap-2 font-semibold text-lg">
            <Server className="size-5 text-primary" /> Self-hosted
          </h2>
          <p className="mt-4 font-semibold text-4xl tracking-tight">$0</p>
          <p className="mt-1 text-muted-foreground text-sm">free forever — AGPL-3.0</p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              'The full platform, no feature gates',
              'One docker compose to deploy',
              'Your database, your storage, your domains',
              'Unlimited everything, forever',
              'Prebuilt images and a Coolify one-click config',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <CopyCommand command="docker compose up -d" />
          </div>
          <a className={`${outlineButton} mt-4`} href="/self-hosting">
            Read the self-hosting guide <ArrowRight className="size-4" />
          </a>
        </div>
      </section>

      {/* Feature comparison */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <div className="flex flex-col items-center text-center">
            <Eyebrow>What's included</Eyebrow>
            <h2 className="mt-4 font-semibold text-3xl tracking-tight">Every feature, both plans</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Self-hosting is not a demo tier. The only differences are who runs the infrastructure.
            </p>
          </div>
          <div className="mt-12 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <div className="grid grid-cols-[1.6fr_1fr_1fr] items-center gap-4 border-border border-b bg-muted/40 px-6 py-3 font-medium text-sm">
              <span />
              <span className="text-center">Cloud</span>
              <span className="text-center">Self-hosted</span>
            </div>
            {featureGroups.map((group) => (
              <div key={group.title} className="group">
                <div className="border-border border-b bg-muted/20 px-6 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  {group.title}
                </div>
                {group.rows.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[1.6fr_1fr_1fr] items-center gap-4 border-border border-b px-6 py-3.5 text-sm group-last:last:border-b-0"
                  >
                    <span>{row.label}</span>
                    <CellValue value={row.cloud} />
                    <CellValue value={row.self} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Beta transparency */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>The fine print, up front</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight">What “free beta” actually means</h2>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {betaPromises.map((item) => (
            <div key={item.title} className="rounded-xl border border-border bg-card p-6">
              <span className="grid size-10 place-items-center rounded-lg border border-border bg-background text-primary">
                <item.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 pb-20" id="faq">
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

      {/* Final CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{ backgroundImage: 'radial-gradient(var(--background) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
            aria-hidden="true"
          />
          <div className="relative">
            <h2 className="font-semibold text-3xl tracking-tight">Start free. Stay free if you self-host.</h2>
            <p className="mx-auto mt-3 max-w-xl text-background/75">
              Try the cloud beta now, or run the whole platform yourself — same code either way.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={primaryButton} href="/sign-up">
                Get started free <ArrowRight className="size-4" />
              </a>
              <a className={invertedOutlineButton} href={GITHUB_URL} rel="noreferrer" target="_blank">
                <GithubIcon className="size-4" /> View on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
