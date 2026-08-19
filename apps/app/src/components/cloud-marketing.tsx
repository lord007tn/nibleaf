import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useTheme } from '@nibleaf/design-system/theme';
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock,
  Cloud,
  Copy,
  FileText,
  GitFork,
  Globe2,
  History,
  Languages,
  Moon,
  PenLine,
  Rocket,
  Scale,
  Search,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { type ComponentType, type ReactNode, type SVGProps, useState } from 'react';
import { BLOG_ENTRIES, blogReadingMinutes } from '@/lib/blog';
import { GITHUB_URL } from '@/lib/links';
import { marketingFaqs } from '@/lib/marketing-faqs';

const buttonBase =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-4 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const INSTALL_COMMAND = 'curl -fsSL https://nibleaf.com/install.sh | sh';
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
});
export const primaryButton = `${buttonBase} bg-primary text-primary-foreground hover:bg-primary/90`;
export const outlineButton = `${buttonBase} border border-border bg-background hover:bg-muted`;
/** Outline button for inverted (bg-foreground) CTA panels: translucent border, hover that stays legible on dark. */
export const invertedOutlineButton = `${buttonBase} border border-background/25 text-background hover:bg-background/10`;
/** Neutral bordered icon tile, matching the marketing site. */
export const iconTile = 'grid place-items-center rounded-lg border border-border bg-background text-foreground';

const navLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: 'https://docs.nibleaf.com', label: 'Docs' },
  { href: '/blog', label: 'Blog' },
  { href: '/tools/rtl-documentation-readiness', label: 'RTL grader' },
  { href: '/self-hosting', label: 'Self-hosting' },
];

const features: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  {
    icon: Globe2,
    title: 'Custom domains',
    body: 'Guided DNS setup and verification, wildcard project subdomains, and per-domain 301 consolidation.',
  },
  {
    icon: BarChart3,
    title: 'First-party analytics',
    body: 'Page views, unique visitors, top pages, and reader searches are built into the product. Hosted traffic is delivered through Cloudflare.',
  },
  {
    icon: ShieldCheck,
    title: 'SEO built in',
    body: 'Server-side rendering, canonicals, Open Graph, JSON-LD, sitemaps, hreflang, and per-page noindex controls out of the box.',
  },
  {
    icon: Users,
    title: 'Per-site teams',
    body: 'Each site is its own workspace with owner, admin, and editor roles — and anchored review comments on any block.',
  },
  {
    icon: FileText,
    title: 'MDX components',
    body: 'Callouts, tabs, code groups, and rich embeds inside plain Markdown — portable content with a component vocabulary.',
  },
  {
    icon: Cloud,
    title: 'Bring your own storage',
    body: 'Any S3-compatible store works: AWS S3, Cloudflare R2, Backblaze B2, or the bundled storage service.',
  },
];

const steps: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  {
    icon: PenLine,
    title: 'Write in Markdown',
    body: 'Author pages in a focused editor with live preview, a page tree, and MDX components. No proprietary format — your content stays portable.',
  },
  {
    icon: Rocket,
    title: 'Publish a version',
    body: 'Every publish snapshots your docs and rebuilds search. Roll forward safely; readers never see a half-written page.',
  },
  {
    icon: Share2,
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
  { label: 'First-class Arabic & RTL', nibleaf: true, them: false },
  { label: 'No per-seat lock-in', nibleaf: true, them: false },
];

const compareLinks = [
  { href: '/compare/nibleaf-vs-mintlify', label: 'Nibleaf vs Mintlify' },
  { href: '/compare/nibleaf-vs-gitbook', label: 'Nibleaf vs GitBook' },
  { href: '/compare/nibleaf-vs-docusaurus', label: 'Nibleaf vs Docusaurus' },
  { href: '/alternatives/mintlify', label: 'Mintlify alternatives' },
];

export function MarketingShell({ children, stars = 0 }: { children: ReactNode; stars?: number }) {
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Announcement />
      <header className="sticky top-0 z-40 border-border/70 border-b bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <a aria-label="Nibleaf home" className="flex items-center gap-2 font-semibold text-lg tracking-tight" href="/">
            <NibleafMark aria-hidden="true" className="size-8" />
            <NibleafWordmark aria-hidden="true" />
          </a>
          <nav className="ms-8 hidden items-center gap-7 text-muted-foreground text-sm md:flex">
            {navLinks.map((link) => (
              <a key={link.href} className="transition-colors hover:text-foreground" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <GitHubStarLink className="h-9 px-2.5 text-muted-foreground hover:text-foreground" compact label="GitHub" stars={stars} />
            <button
              aria-label={`Switch to ${nextTheme} mode`}
              className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setTheme(nextTheme)}
              title={`Switch to ${nextTheme} mode`}
              type="button"
            >
              {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <a className="hidden h-9 items-center rounded-md px-3 text-sm hover:bg-muted sm:inline-flex" href="/sign-in">
              Sign in
            </a>
            <a aria-label="Get started" className={cn(primaryButton, 'h-9 px-3')} href="/sign-up">
              <span className="sm:hidden">Start</span>
              <span className="hidden sm:inline">Get started</span>
            </a>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <SiteFooter stars={stars} />
    </div>
  );
}

export function LandingPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <Hero stars={stars} />
      <TrustStrip />
      <ShowcaseEditor />
      <ShowcasePublish />
      <ShowcaseBilingual />
      <Features />
      <HowItWorks />
      <ChooseYourPath />
      <Comparison />
      <BlogTeaser />
      <Faq />
      <FinalCta />
    </MarketingShell>
  );
}

export function CloudPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <section className="relative overflow-hidden border-border border-b">
        <GridBackground />
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Nibleaf Cloud</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Hosted documentation sites, free during beta</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            Nibleaf managed for you: hosted dashboard, database and storage, automatic upgrades, custom domains, analytics, and Arabic-ready
            authoring.
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

function Announcement() {
  return (
    <a
      href="/pricing"
      className="group flex items-center justify-center gap-2 border-border/70 border-b bg-muted/60 px-4 py-2 text-center text-muted-foreground text-xs transition-colors hover:text-foreground"
    >
      <Sparkles className="size-3.5 text-primary" />
      <span>Free cloud beta or self-host with the public AGPL-3.0 release.</span>
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        Learn more <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}

function Hero({ stars }: { stars: number }) {
  return (
    <section className="relative overflow-hidden border-border border-b">
      <GridBackground />
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:py-24">
        <div className="min-w-0">
          <a
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-medium text-muted-foreground text-xs shadow-xs transition-colors hover:text-foreground"
            href="/self-hosting"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Free cloud beta · AGPL-3.0 codebase
          </a>
          <h1 className="mt-6 text-balance font-semibold text-5xl tracking-tight sm:text-6xl">The visual Markdown alternative to Mintlify.</h1>
          <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            Nibleaf is a documentation platform with a Notion-style editor over Markdown, versioned publishing, built-in search and analytics, and
            first-class Arabic/RTL. Use the free cloud beta or install the public AGPL-3.0 release on your own infrastructure.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className={`${primaryButton} group`} href="/sign-up">
              Start writing — it's free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <GitHubStarLink stars={stars} />
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 flex-1">
              <CopyCommand command={INSTALL_COMMAND} />
            </div>
            <a
              aria-label="Read the self-hosting guide"
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-4 font-medium text-sm transition-colors hover:bg-muted"
              href="/self-hosting"
            >
              Guide <ArrowRight className="size-4" />
            </a>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground text-sm">
            {['No credit card required', 'Your content stays Markdown', 'English and Arabic'].map((item) => (
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

/** Quiet, honest numbers — no fabricated logos or testimonials. */
function TrustStrip() {
  const stats = [
    { value: 'AGPL-3.0', label: 'licensed codebase' },
    { value: 'Beta', label: 'cloud access available' },
    { value: '2 languages', label: 'English & Arabic, full RTL' },
    { value: 'Built in', label: 'product analytics' },
  ];
  return (
    <section className="border-border border-b bg-card/40">
      <div className="mx-auto grid max-w-6xl grid-cols-2 px-6 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.value} className="flex flex-col gap-1 py-7 text-center">
            <span className="font-semibold text-2xl tracking-tight">{stat.value}</span>
            <span className="text-muted-foreground text-sm">{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Shared two-column showcase row: copy on one side, a CSS product mock on the other. */
function ShowcaseRow({
  eyebrow,
  title,
  body,
  bullets,
  cta,
  visual,
  flip = false,
  tinted = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  cta?: { href: string; label: string };
  visual: ReactNode;
  flip?: boolean;
  tinted?: boolean;
}) {
  return (
    <section className={tinted ? 'border-border border-y bg-card/40' : ''}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-24">
        <div className={flip ? 'lg:order-2' : ''}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-4 text-balance font-semibold text-3xl tracking-tight sm:text-4xl">{title}</h2>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">{body}</p>
          <ul className="mt-6 space-y-3 text-[15px]">
            {bullets.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                  <Check className="size-3" />
                </span>
                {item}
              </li>
            ))}
          </ul>
          {cta ? (
            <a className="group mt-7 inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:text-primary/80" href={cta.href}>
              {cta.label} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
            </a>
          ) : null}
        </div>
        <div className={flip ? 'lg:order-1' : ''}>{visual}</div>
      </div>
    </section>
  );
}

function ShowcaseEditor() {
  return (
    <ShowcaseRow
      eyebrow="The editor"
      title="Write like Notion. Own it like Markdown."
      body="Blocks, a slash menu, live preview, and rich MDX components, with one crucial difference: pages are stored as Markdown and can be exported for use elsewhere."
      bullets={[
        'Slash menu with callouts, tabs, code groups, tables, and media',
        'Content is stored as Markdown — never a proprietary JSON format',
        'Anchored review comments on any block, Figma-style',
      ]}
      cta={{ href: '/sign-up', label: 'Try the editor on the free beta' }}
      visual={<EditorMock />}
    />
  );
}

function ShowcasePublish() {
  return (
    <ShowcaseRow
      flip
      tinted
      eyebrow="Publishing"
      title="Versions your readers can trust"
      body="Every publish is an immutable snapshot with its own search index. Readers never see a half-written page, and rolling back is one click — republish any earlier version."
      bullets={[
        'Immutable snapshots — no live-editing accidents in production',
        'Full-text + fuzzy search rebuilt on every publish, no Algolia bill',
        'Cmd+K search UI with a bilingual Arabic-aware tokenizer',
      ]}
      cta={{ href: '/pricing', label: 'See what ships on every plan' }}
      visual={<PublishMock />}
    />
  );
}

function ShowcaseBilingual() {
  return (
    <ShowcaseRow
      eyebrow="Bilingual by design"
      title="Arabic-first. RTL that actually works."
      body="Most docs platforms bolt RTL on as an afterthought. Nibleaf was built bilingual from day one: per-language page trees, mirrored layout, localized chrome, and hreflang emitted for every page."
      bullets={[
        'Per-language page trees — structure each language independently',
        'True RTL layout in the editor, dashboard, and published site',
        'Arabic search tokenization built into the index',
      ]}
      cta={{ href: '/blog/arabic-documentation-rtl', label: 'Read: what RTL-first actually takes' }}
      visual={<BilingualMock />}
    />
  );
}

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="features">
      <div className="max-w-2xl">
        <Eyebrow>Features</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Everything else you'd expect — included</h2>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
          The full docs workflow in one managed product, with portable Markdown content.
        </p>
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
        <ol className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background text-primary">
                  <step.icon className="size-5" />
                </span>
                <span className="font-mono font-semibold text-3xl text-muted-foreground/60 leading-none">{`0${i + 1}`}</span>
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

/** Copies a shell command; renders identically on server and client until clicked. */
export function CopyCommand({ command }: { command: string }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () => {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      setCopyStatus('failed');
      return;
    }
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus('idle'), 2000);
      })
      .catch(() => {
        setCopyStatus('failed');
      });
  };
  const copied = copyStatus === 'copied';
  const copyLabel = copied ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy';
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copyStatus === 'idle' ? `Copy ${command}` : copyLabel}
      className="group flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-[#0d1117] px-4 py-3 text-start font-mono text-sm text-white/90 transition-colors hover:border-primary/40 sm:h-12 sm:py-0"
      dir="ltr"
    >
      <span className="min-w-0 break-all sm:overflow-x-auto sm:whitespace-nowrap">
        <span className="select-none text-primary">$ </span>
        {command}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 font-sans font-medium text-[11px] text-white/45 uppercase tracking-wide group-hover:text-white/80">
        {copyLabel}
        {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}

/** Two honest paths to production — the section that replaces a plans-and-tiers pitch. */
function ChooseYourPath() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24" id="pricing">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow>Two ways to run it</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Free beta or self-hosted</h2>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">Start on the managed beta or run the published Docker Compose stack yourself.</p>
        </div>
        <a className={outlineButton} href="/pricing">
          Compare in detail <ArrowRight className="size-4" />
        </a>
      </div>
      <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-primary/30 bg-card p-8 shadow-lg shadow-black/[0.06] ring-1 ring-primary/20">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-semibold text-lg">
              <Cloud className="size-5 text-primary" /> Nibleaf Cloud
            </h3>
            <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground text-xs">Fastest start</span>
          </div>
          <p className="mt-4 font-semibold text-4xl tracking-tight">Free during beta</p>
          <p className="mt-1.5 text-muted-foreground text-sm">Managed hosting: database, storage, deploys, and upgrades handled for you.</p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              'Live in 60 seconds — sign up and write',
              'Custom domains and analytics included',
              'Beta workspaces get preferential treatment later',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
          <a className={`${primaryButton} mt-7 w-full`} href="/sign-up">
            Start on Cloud <ArrowRight className="size-4" />
          </a>
          <p className="mt-3 text-center text-muted-foreground text-xs">No credit card required.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-8">
          <h3 className="flex items-center gap-2 font-semibold text-lg">
            <Server className="size-5 text-primary" /> Self-hosted
          </h3>
          <p className="mt-4 font-semibold text-4xl tracking-tight">AGPL-3.0</p>
          <p className="mt-1.5 text-muted-foreground text-sm">
            Public source, a pinned GHCR image, and a guided Docker Compose installer for your own infrastructure.
          </p>
          <a className={`${outlineButton} mt-6 w-full`} href="/self-hosting">
            View self-hosting guide <ArrowRight className="size-4" />
          </a>
          <p className="mt-3 text-center text-muted-foreground text-xs">You manage DNS, TLS, backups, and upgrades.</p>
        </div>
      </div>
    </section>
  );
}

function Comparison() {
  return (
    <section className="border-border border-y bg-card/40" id="compare">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <div className="flex flex-col items-center text-center">
          <Eyebrow>Comparison</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">A docs platform without lock-in</h2>
          <p className="mt-4 text-lg text-muted-foreground">A hosted product with Markdown export and a public self-hosted release.</p>
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
            <div
              key={row.label}
              className="grid grid-cols-[1fr_5rem_5rem] items-center gap-4 border-border border-b px-6 py-3.5 text-sm last:border-0"
            >
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
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-muted-foreground text-sm">
          <span>Deep dives:</span>
          {compareLinks.map((link, i) => (
            <span key={link.href} className="inline-flex items-center gap-2">
              {i > 0 ? <span aria-hidden="true">·</span> : null}
              <a className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline" href={link.href}>
                {link.label}
              </a>
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

/** Three newest articles — kept intentionally light (metadata only, no cover art). */
function BlogTeaser() {
  const latest = BLOG_ENTRIES.slice(0, 3);
  if (latest.length === 0) {
    return null;
  }
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow>From the blog</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Notes on documentation and ownership</h2>
        </div>
        <a className={outlineButton} href="/blog">
          All articles <ArrowRight className="size-4" />
        </a>
      </div>
      <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
        {latest.map((entry) => (
          <article key={entry.slug} className="h-full">
            <a
              className="group flex h-full flex-col rounded-xl border border-border bg-card p-6 shadow-xs transition-colors hover:border-primary/40"
              href={`/blog/${entry.slug}`}
            >
              <h3 className="font-semibold text-lg leading-snug tracking-tight transition-colors group-hover:text-primary">{entry.title}</h3>
              <p className="mt-2 mb-5 line-clamp-3 text-muted-foreground text-sm leading-relaxed">{entry.description}</p>
              <div className="mt-auto flex items-center gap-2 text-muted-foreground text-xs">
                <time dateTime={entry.datePublished}>
                  {new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(entry.datePublished))}
                </time>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock aria-hidden="true" className="size-3.5" /> {blogReadingMinutes(entry)} min read
                </span>
              </div>
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-24" id="faq">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Frequently asked</h2>
      </div>
      <div className="mt-12 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {marketingFaqs.map((item) => (
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
            Start free on Nibleaf Cloud today, or review the infrastructure checklist before self-hosting.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a className={`${primaryButton} group`} href="/sign-up">
              Get started free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a className={invertedOutlineButton} href="/self-hosting">
              <Server className="size-4" /> Self-hosting guide
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const footerColumns: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/cloud', label: 'Nibleaf Cloud' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/self-hosting', label: 'Self-hosting' },
    ],
  },
  {
    title: 'Compare',
    links: [
      { href: '/compare/nibleaf-vs-mintlify', label: 'vs Mintlify' },
      { href: '/compare/nibleaf-vs-gitbook', label: 'vs GitBook' },
      { href: '/compare/nibleaf-vs-docusaurus', label: 'vs Docusaurus' },
      { href: '/alternatives/mintlify', label: 'Mintlify alternatives' },
      { href: '/alternatives/gitbook', label: 'GitBook alternatives' },
      { href: '/alternatives/readme', label: 'ReadMe alternatives' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/blog', label: 'Blog' },
      { href: '/tools/rtl-documentation-readiness', label: 'RTL grader' },
      { href: 'https://docs.nibleaf.com', label: 'Documentation', external: true },
      { href: '/about', label: 'About' },
      { href: '/self-hosting', label: 'Self-hosting' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
];

export function GitHubStarLink({
  stars,
  className,
  compact = false,
  label = 'Star on GitHub',
}: {
  stars: number;
  className?: string;
  compact?: boolean;
  label?: string;
}) {
  const count = Number.isFinite(stars) ? Math.max(0, Math.floor(stars)) : 0;
  const starLabel = count === 1 ? '1 star' : `${count.toLocaleString('en-US')} stars`;
  const displayCount =
    count < 1000 ? count.toLocaleString('en-US') : compactNumberFormatter.format(count).replace(/[KMBT]/g, (unit) => unit.toLowerCase());

  return (
    <a
      aria-label={`Star Nibleaf on GitHub — ${starLabel}`}
      className={cn(outlineButton, 'group px-3', className)}
      href={GITHUB_URL}
      rel="noreferrer"
      target="_blank"
    >
      <GitHubGlyph aria-hidden="true" className="size-4" />
      <span className={cn(compact && 'hidden lg:inline')}>{label}</span>
      <Star aria-hidden="true" className={cn('size-3.5', !compact && 'hidden sm:block')} />
      <span className="min-w-7 border-border border-s ps-2 text-muted-foreground tabular-nums" data-github-stars={count}>
        {displayCount}
      </span>
    </a>
  );
}

function GitHubGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.39.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.95 10.95 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function SiteFooter({ stars }: { stars: number }) {
  return (
    <footer className="border-border border-t bg-card/30">
      <div className="border-border border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-7 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 font-medium text-muted-foreground text-xs">
              <GitFork aria-hidden="true" className="size-3.5" />
              Open source · AGPL-3.0
            </div>
            <h2 className="mt-4 text-balance font-semibold text-2xl tracking-tight sm:text-3xl">Documentation infrastructure you can own.</h2>
            <p className="mt-2 max-w-xl text-muted-foreground text-sm leading-relaxed sm:text-base">
              Read the code, run Nibleaf on your own infrastructure, and help shape a documentation platform built in public.
            </p>
          </div>
          <GitHubStarLink className="h-11 self-start px-4 sm:self-auto" stars={stars} />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-1">
            <a aria-label="Nibleaf home" className="flex items-center gap-2 font-semibold" href="/">
              <NibleafMark aria-hidden="true" className="size-7" />
              <span aria-hidden="true">Nibleaf</span>
            </a>
            <p className="mt-3 max-w-[28ch] text-muted-foreground text-sm leading-relaxed">
              A visual Markdown editor for publishing searchable, multilingual product documentation.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              <a
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                href={`${GITHUB_URL}/blob/main/LICENSE`}
                rel="noreferrer"
                target="_blank"
              >
                <Scale aria-hidden="true" className="size-3.5" /> AGPL-3.0-only
              </a>
              <a
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                href={GITHUB_URL}
                rel="noreferrer"
                target="_blank"
              >
                <GitHubGlyph aria-hidden="true" className="size-3.5" /> Source code
              </a>
            </div>
          </div>
          {footerColumns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="font-semibold text-sm">{column.title}</h3>
              <ul className="mt-3 space-y-2.5 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      href={link.href}
                      {...(link.external ? { rel: 'noreferrer', target: '_blank' } : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-4 border-border border-t pt-6 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Nibleaf. Built in public under AGPL-3.0.</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a className="transition-colors hover:text-foreground" href={GITHUB_URL} rel="noreferrer" target="_blank">
              GitHub
            </a>
            <a className="transition-colors hover:text-foreground" href="https://docs.nibleaf.com" rel="noreferrer" target="_blank">
              Documentation
            </a>
            <a className="transition-colors hover:text-foreground" href="/contact">
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function DocsPreview() {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/[0.08]">
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-medium text-sm">
                <ShieldCheck className="size-4 text-primary" /> Published and indexed
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs" aria-hidden="true">
                <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">EN</span>
                <span className="rounded-md bg-background px-2 py-1">عربي</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-background" />
              <div className="h-3 w-10/12 rounded bg-background" />
              <div className="h-3 w-1/2 rounded bg-background" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Editor mock: page tree + block canvas with an open slash menu. */
function EditorMock() {
  const slashItems = [
    { icon: FileText, label: 'Callout' },
    { icon: Workflow, label: 'Tabs' },
    { icon: Search, label: 'Code group' },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/[0.06]">
      <div className="flex items-center justify-between border-border border-b px-4 py-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <PenLine className="size-3.5" /> Getting started.md
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 font-medium text-muted-foreground text-xs">Draft</span>
      </div>
      <div className="p-6">
        <div className="mb-4 h-7 w-2/3 rounded bg-foreground/10" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-10/12 rounded bg-muted" />
        </div>
        <div className="relative mt-5">
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 font-mono text-primary text-sm">/</div>
          <div className="mt-2 w-56 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
            {slashItems.map((item, index) => (
              <div
                key={item.label}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm ${index === 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              >
                <item.icon className="size-4" /> {item.label}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-muted-foreground text-xs" dir="ltr">
          ## Quick start — plain Markdown, always
        </div>
      </div>
    </div>
  );
}

/** Publish mock: version timeline with a live snapshot and search rebuild. */
function PublishMock() {
  const versions = [
    { name: 'v14', note: 'Custom domain guide', state: 'Live', live: true },
    { name: 'v13', note: 'API reference update', state: 'Archived', live: false },
    { name: 'v12', note: 'Launch docs', state: 'Archived', live: false },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/[0.06]">
      <div className="flex items-center justify-between border-border border-b px-4 py-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <History className="size-3.5" /> Publish history
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 text-xs dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-500" /> Search index fresh
        </span>
      </div>
      <div className="divide-y divide-border">
        {versions.map((version) => (
          <div key={version.name} className="flex items-center gap-4 px-5 py-4">
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-lg border font-mono font-semibold text-xs ${version.live ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground'}`}
            >
              {version.name}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">{version.note}</p>
              <p className="text-muted-foreground text-xs">Immutable snapshot · search rebuilt</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${version.live ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
            >
              {version.state}
            </span>
          </div>
        ))}
      </div>
      <div className="border-border border-t bg-muted/30 px-5 py-3.5">
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-muted-foreground text-sm">
          <Search className="size-4" /> Search docs… <span className="ms-auto rounded bg-muted px-1.5 py-0.5 font-mono text-xs">⌘K</span>
        </div>
      </div>
    </div>
  );
}

/** Bilingual mock: the same page mirrored EN (LTR) and AR (RTL). */
function BilingualMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/[0.06]">
      <div className="flex items-center justify-between border-border border-b px-4 py-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Languages className="size-3.5" /> One site, two languages
        </div>
        <div className="flex items-center gap-1.5 text-xs" aria-hidden="true">
          <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">EN</span>
          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">عربي</span>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border">
        <div className="p-5" dir="ltr">
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">English</p>
          <div className="mb-3 h-5 w-4/5 rounded bg-foreground/10" />
          <div className="space-y-2">
            <div className="h-2.5 w-full rounded bg-muted" />
            <div className="h-2.5 w-11/12 rounded bg-muted" />
            <div className="h-2.5 w-3/5 rounded bg-muted" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="h-6 w-14 rounded-md bg-primary/15" />
            <span className="h-6 w-10 rounded-md bg-muted" />
          </div>
        </div>
        <div className="bg-muted/20 p-5" dir="rtl">
          <p className="mb-3 font-medium text-muted-foreground text-xs">العربية</p>
          <div className="mb-3 h-5 w-4/5 rounded bg-foreground/10" />
          <div className="space-y-2">
            <div className="h-2.5 w-full rounded bg-muted" />
            <div className="h-2.5 w-11/12 rounded bg-muted" />
            <div className="h-2.5 w-3/5 rounded bg-muted" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="h-6 w-14 rounded-md bg-primary/15" />
            <span className="h-6 w-10 rounded-md bg-muted" />
          </div>
        </div>
      </div>
      <div className="border-border border-t px-5 py-3 text-center text-muted-foreground text-xs">
        Per-language page trees · mirrored layout · hreflang emitted automatically
      </div>
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
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
