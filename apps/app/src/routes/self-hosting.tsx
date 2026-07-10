import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Boxes, Check, Database, HardDrive, Rocket, Server, Zap } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { Eyebrow, iconTile, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import { GithubIcon } from '@/components/icons/brand';
import { GITHUB_URL } from '@/lib/links';
import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/self-hosting')({
  head: () => ({
    meta: pageMeta({
      title: 'Self-hosting Nibleaf — run your docs platform on your own infrastructure',
      description:
        "Run the entire open-source Nibleaf stack on your own infrastructure with one docker compose. Free forever under AGPL-3.0 — your content and your readers' data never leave your servers.",
      path: '/self-hosting',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/self-hosting') }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Self-hosting', path: '/self-hosting' },
      ]),
    ],
  }),
  component: SelfHostingPage,
});

const REQUIREMENTS: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { icon: Boxes, title: 'Docker & Compose', body: 'Any Linux host, VPS, or homelab that runs Docker Compose.' },
  { icon: Database, title: 'PostgreSQL', body: 'Bundled by default, or bring your own managed Postgres.' },
  { icon: Zap, title: 'Redis-compatible cache', body: 'Powers the publish queue and background jobs. Bundled.' },
  {
    icon: HardDrive,
    title: 'S3-compatible storage',
    body: 'For images and assets — AWS S3, Cloudflare R2, Backblaze B2, or the bundled storage service.',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Clone the repository', body: 'Grab the source from GitHub.' },
  { title: 'Configure your environment', body: 'Copy .env.example to .env and set your domain and secrets.' },
  { title: 'Bring up the stack', body: 'One command starts every service and runs database migrations.' },
  { title: 'Create your account', body: 'Open the app and create the first owner account — no demo credentials in production.' },
];

const GET: string[] = [
  'Unlimited sites, pages, and team members — no feature gates',
  'Built-in search, analytics, and custom domains',
  'Automatic database migrations on every release',
  'Bilingual (English + Arabic) authoring with full RTL',
];

const DEPLOY: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { icon: Boxes, title: 'Docker Compose', body: 'The reference setup — copy the compose file and go.' },
  { icon: Rocket, title: 'Coolify', body: 'One-click self-hosting with a ready-made compose config that pulls the prebuilt image.' },
  { icon: Server, title: 'Your own orchestrator', body: 'Plain containers for Kubernetes, Nomad, or bare metal.' },
];

function SelfHostingPage() {
  return (
    <MarketingShell>
      {/* Header */}
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Self-host</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Run Nibleaf on your own infrastructure</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            One docker compose brings up the whole stack — app, API, worker, database, cache, and object storage. Free forever under AGPL-3.0. Your
            content and your users' data never leave your servers.
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

      {/* Steps + terminal */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <div>
            <Eyebrow>Four steps</Eyebrow>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">From clone to live in minutes</h2>
            <ol className="mt-8 space-y-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-[#0d1117] font-mono text-sm shadow-xl shadow-black/5" dir="ltr">
            <div className="flex items-center gap-1.5 border-white/10 border-b px-4 py-3">
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="ms-3 text-white/40 text-xs">terminal</span>
            </div>
            <pre className="overflow-x-auto p-5 text-white/90 leading-relaxed">{`# 1 · clone
git clone ${GITHUB_URL.replace('https://', '')}
cd nibleaf

# 2 · configure
cp .env.example .env

# 3 · bring it up
docker compose up -d

# 4 · open http://localhost:4310
#     and create your account`}</pre>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <h2 className="font-semibold text-3xl tracking-tight">Everything included, nothing locked away</h2>
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
              <div key={d.title} className="rounded-xl border border-border bg-background p-6">
                <span className={`${iconTile} size-10`}>
                  <d.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-lg">{d.title}</h3>
                <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-24">
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
              <a
                className={`${outlineButton} border-background/25 bg-transparent text-background hover:bg-background/10`}
                href={`${GITHUB_URL}#readme`}
                rel="noreferrer"
                target="_blank"
              >
                Read the docs
                <ArrowRight className="size-4 rtl:rotate-180" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
