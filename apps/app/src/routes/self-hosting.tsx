import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Boxes, Check, Cloud, Database, HardDrive, Lock, Rocket, Server, Workflow, Zap } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { CopyCommand, Eyebrow, iconTile, invertedOutlineButton, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import { GithubIcon } from '@/components/icons/brand';
import { GITHUB_URL } from '@/lib/links';
import { breadcrumbLd, canonicalHref, faqLd, howToLd, pageMeta } from '@/lib/marketing-seo';

const QUICK_START: { title: string; body: string; command: string }[] = [
  {
    title: 'Clone the repository',
    body: 'Grab the open-source stack from GitHub.',
    command: 'git clone https://github.com/lord007tn/nibleaf && cd nibleaf',
  },
  {
    title: 'Configure your environment',
    body: 'Set your domain and secrets — the example file documents every variable.',
    command: 'cp .env.example .env',
  },
  {
    title: 'Bring up the stack',
    body: 'One command starts every service and runs database migrations automatically.',
    command: 'docker compose up -d',
  },
  { title: 'Create your account', body: 'Open the app and sign up — no demo credentials in production.', command: 'open http://localhost:4310' },
];

const INTERACTIVE_INSTALL = 'curl -fsSL https://nibleaf.com/install.sh | sh';

const SELF_HOST_FAQS: { q: string; a: string }[] = [
  {
    q: 'What does self-hosting Nibleaf cost?',
    a: 'Nothing. The platform is open source under AGPL-3.0 and free forever — the only costs are your own servers. There are no feature gates and no paid tier to unlock.',
  },
  {
    q: 'What are the minimum server requirements?',
    a: 'Any Linux host that runs Docker Compose. A small VPS with 2 GB of RAM comfortably runs the whole stack for a team; PostgreSQL, the cache, and object storage are bundled.',
  },
  {
    q: 'How do upgrades work?',
    a: 'Pull the new image and restart — database migrations run automatically on every release. Prebuilt images are published to GHCR.',
  },
  {
    q: 'Can I use my own database and object storage?',
    a: 'Yes. Point the environment at a managed PostgreSQL and any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2) instead of the bundled services.',
  },
  {
    q: 'Is the self-hosted version feature-complete?',
    a: 'Yes — it is the same code that runs Nibleaf Cloud: editor, versioned publishing, search, analytics, custom domains, and bilingual Arabic/English support, with nothing held back.',
  },
];

export const Route = createFileRoute('/self-hosting')({
  head: () => ({
    meta: pageMeta({
      title: 'Self-host Nibleaf — deploy docs with Docker Compose',
      description:
        'Run the open-source Nibleaf docs platform on your own servers with one docker compose. Free forever under AGPL-3.0, no feature gates.',
      path: '/self-hosting',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/self-hosting') }],
    scripts: [
      howToLd({
        name: 'How to self-host Nibleaf with Docker Compose',
        description: 'Deploy the open-source Nibleaf documentation platform on your own infrastructure in four steps.',
        totalTime: 'PT10M',
        steps: QUICK_START.map((step) => ({ name: step.title, text: `${step.body} Run: ${step.command}` })),
      }),
      faqLd(SELF_HOST_FAQS),
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Self-hosting', path: '/self-hosting' },
      ]),
    ],
  }),
  component: SelfHostingPage,
});

const REQUIREMENTS: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { icon: Boxes, title: 'Docker & Compose', body: 'Any Linux host, VPS, or homelab that runs Docker Compose. 2 GB RAM is plenty to start.' },
  { icon: Database, title: 'PostgreSQL', body: 'Bundled by default, or bring your own managed Postgres.' },
  { icon: Zap, title: 'Redis-compatible cache', body: 'Powers the publish queue and background jobs. Bundled.' },
  {
    icon: HardDrive,
    title: 'S3-compatible storage',
    body: 'For images and assets — AWS S3, Cloudflare R2, Backblaze B2, or the bundled storage service.',
  },
];

const STACK: { name: string; role: string }[] = [
  { name: 'app', role: 'Dashboard, editor, and published sites (SSR)' },
  { name: 'api', role: 'REST API, auth, and publishing pipeline' },
  { name: 'worker', role: 'Background jobs: publishes, search indexing, domains' },
  { name: 'postgres', role: 'Your content, users, and analytics' },
  { name: 'cache', role: 'Queues and hot data (Redis-compatible)' },
  { name: 'storage', role: 'Images and assets (S3-compatible)' },
];

const GET: string[] = [
  'Unlimited sites, pages, and team members — no feature gates',
  'Built-in search, analytics, and custom domains',
  'Automatic database migrations on every release',
  'Bilingual (English + Arabic) authoring with full RTL',
  'Prebuilt images on GHCR — no build step required',
  'Your data never leaves your servers',
];

const DEPLOY: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string; href: string; cta: string }[] = [
  {
    icon: Boxes,
    title: 'Docker Compose',
    body: 'The reference setup — clone the repo, copy the compose file, and go.',
    href: `${GITHUB_URL}#readme`,
    cta: 'Read the setup guide',
  },
  {
    icon: Rocket,
    title: 'Coolify',
    body: 'One-click self-hosting with a ready-made compose config that pulls the prebuilt image.',
    href: `${GITHUB_URL}/blob/main/docker-compose.coolify.yml`,
    cta: 'Get the Coolify config',
  },
  {
    icon: Server,
    title: 'Your own orchestrator',
    body: 'Plain containers for Kubernetes, Nomad, or bare metal — no vendor glue.',
    href: `${GITHUB_URL}/pkgs/container/nibleaf`,
    cta: 'Browse the images',
  },
];

function SelfHostingPage() {
  return (
    <MarketingShell>
      {/* Hero — direct deploy CTA above the fold */}
      <section className="relative overflow-hidden border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Self-host</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Run Nibleaf on your own infrastructure</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            One docker compose brings up the whole stack — app, API, worker, database, cache, and object storage. Free forever under AGPL-3.0. Your
            content and your readers' data never leave your servers.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a className={primaryButton} href="#quick-start">
              <Server className="size-4" /> Deploy now — 4 steps
            </a>
            <a className={outlineButton} href={GITHUB_URL} rel="noreferrer" target="_blank">
              <GithubIcon className="size-4" /> View source
            </a>
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-muted-foreground text-sm">
            {['About 10 minutes start to finish', 'No feature gates', 'Prebuilt images on GHCR'].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" /> {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Quick start — copy-paste deploy */}
      <section className="border-border border-b bg-card/40" id="quick-start">
        <div className="mx-auto max-w-6xl scroll-mt-24 px-6 py-20">
          <div className="max-w-2xl">
            <Eyebrow>Quick start</Eyebrow>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">Deploy with one guided command</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Run this on your Linux server. It downloads the production Compose file, prompts for your domains and mail provider, generates strong
              secrets locally, and starts the stack.
            </p>
          </div>
          <div className="mt-8 rounded-xl border border-primary/25 bg-primary/5 p-6">
            <div className="flex items-start gap-3">
              <span className={`${iconTile} size-10 shrink-0 border-primary/20 bg-primary/10 text-primary`}>
                <Rocket className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold">Interactive production installer</h3>
                <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                  Nothing sensitive is sent to Nibleaf. Generated credentials are written only to a permission-restricted <code>.env</code> on your
                  server.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <CopyCommand command={INTERACTIVE_INSTALL} />
            </div>
          </div>
          <div className="mt-12 max-w-2xl">
            <h3 className="font-semibold text-xl tracking-tight">Or configure it manually</h3>
            <p className="mt-2 text-muted-foreground">Use the individual commands when you want to inspect or customize every file before launch.</p>
          </div>
          <ol className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {QUICK_START.map((step, i) => (
              <li key={step.title} className="flex flex-col rounded-xl border border-border bg-card p-6">
                <div className="flex items-start gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{step.body}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <CopyCommand command={step.command} />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-muted-foreground text-sm">
            Production tip: set <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">APP_URL</code> to your domain
            and configure an email provider (or disable email verification) before inviting your team — every variable is documented in{' '}
            <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">.env.production.example</code>.
          </p>
        </div>
      </section>

      {/* Requirements */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="font-semibold text-3xl tracking-tight">What you need</h2>
          <p className="mt-3 text-lg text-muted-foreground">A single host with Docker. Nibleaf ships everything else.</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {REQUIREMENTS.map((req) => (
            <div key={req.title} className="rounded-xl border border-border bg-card p-5">
              <span className={`${iconTile} size-10`}>
                <req.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{req.title}</h3>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{req.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What's in the stack */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <Eyebrow>Architecture</Eyebrow>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">What docker compose actually starts</h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Six services, each replaceable with your own managed equivalent when you outgrow the bundled ones.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map((service) => (
              <div key={service.name} className="bg-card p-6">
                <div className="flex items-center gap-2.5">
                  <Workflow className="size-4 text-primary" />
                  <span className="font-mono font-semibold text-sm">{service.name}</span>
                </div>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{service.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you get + ownership */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-semibold text-3xl tracking-tight">Everything included, nothing locked away</h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              The self-hosted release is the same code that runs Nibleaf Cloud — not a community edition with the good parts held back. When you
              outgrow a single box, point it at managed Postgres and object storage and keep going.
            </p>
            <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card p-4">
              <span className={`${iconTile} size-10 shrink-0`}>
                <Lock className="size-5" />
              </span>
              <p className="text-muted-foreground text-sm leading-relaxed">
                <span className="font-medium text-foreground">Data ownership, literally.</span> Content is plain Markdown in your database, assets sit
                in your bucket, analytics are first-party. Leaving Nibleaf means copying your own files.
              </p>
            </div>
          </div>
          <ul className="space-y-4">
            {GET.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[15px]">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                  <Check className="size-3" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Deploy your way */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-semibold text-3xl tracking-tight">Deploy your way</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {DEPLOY.map((d) => (
              <div key={d.title} className="flex flex-col rounded-xl border border-border bg-background p-6">
                <span className={`${iconTile} size-10`}>
                  <d.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-lg">{d.title}</h3>
                <p className="mt-1.5 mb-5 text-muted-foreground text-sm leading-relaxed">{d.body}</p>
                <a
                  className="group mt-auto inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:text-primary/80"
                  href={d.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {d.cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Self-hosting FAQ */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <div className="flex flex-col items-center text-center">
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight">Self-hosting questions</h2>
        </div>
        <div className="mt-12 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {SELF_HOST_FAQS.map((item) => (
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

      {/* Cloud escape hatch */}
      <section className="mx-auto max-w-5xl px-6 pb-8">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center sm:flex-row sm:text-start">
          <span className={`${iconTile} size-10 shrink-0`}>
            <Cloud className="size-5" />
          </span>
          <p className="flex-1 text-muted-foreground text-sm leading-relaxed">
            <span className="font-medium text-foreground">Not ready to run servers?</span> Nibleaf Cloud is the same platform, hosted and free during
            beta — and your content stays portable Markdown either way.
          </p>
          <a className={`${outlineButton} shrink-0`} href="/sign-up">
            Try Cloud free
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{ backgroundImage: 'radial-gradient(var(--background) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
            aria-hidden="true"
          />
          <div className="relative">
            <h2 className="font-semibold text-3xl tracking-tight">Ready to run your own docs platform?</h2>
            <p className="mx-auto mt-3 max-w-xl text-background/75">Clone the repo and be live in minutes — or start on the free cloud beta first.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={primaryButton} href={GITHUB_URL} rel="noreferrer" target="_blank">
                <GithubIcon className="size-4" /> Get the source
              </a>
              <a className={invertedOutlineButton} href="#quick-start">
                Back to quick start
                <ArrowRight className="size-4 rtl:rotate-180" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
