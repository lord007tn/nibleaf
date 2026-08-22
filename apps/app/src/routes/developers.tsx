import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Bot, Braces, ShieldCheck, Terminal } from 'lucide-react';
import { Eyebrow, iconTile, MarketingShell, primaryButton } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/developers')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf developer resources: OpenAPI, agents, and CLI',
      description:
        'Discover the Nibleaf public reader API, OpenAPI schema, Markdown content negotiation, llms files, authentication boundaries, and official CLI.',
      path: '/developers',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/developers') }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Developer resources', path: '/developers' },
      ]),
    ],
  }),
  component: DeveloperRoute,
});

function DeveloperRoute() {
  const { stars } = Route.useLoaderData();
  return <DeveloperResourcesPage stars={stars} />;
}

const resources = [
  {
    icon: Braces,
    title: 'Nibleaf public OpenAPI',
    body: 'A typed OpenAPI 3.1 contract for reading published sites, pages, search results, changelogs, sitemaps, and agent indexes. Every operation has a unique operationId and description.',
    href: '/openapi.json',
    label: 'Open openapi.json',
  },
  {
    icon: Bot,
    title: 'Agent-readable content',
    body: 'Start with llms.txt, request canonical marketing URLs with Accept: text/markdown, and use each published site’s own sitemap and llms files for recovery and retrieval.',
    href: '/llms.txt',
    label: 'Read llms.txt',
  },
  {
    icon: Terminal,
    title: 'Official Nibleaf CLI',
    body: 'The @nibleaf/cli package inspects a Nibleaf site’s machine-readable endpoints and fetches canonical pages as Markdown for scripts and agents.',
    href: 'https://www.npmjs.com/package/@nibleaf/cli',
    label: 'View the npm package',
  },
] as const;

export function DeveloperResourcesPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <section className="border-border border-b">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Developers and agents</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Nibleaf developer resources</h1>
          <p className="mx-auto mt-4 max-w-3xl text-balance text-lg text-muted-foreground leading-relaxed">
            Discover the supported public reader API, machine-readable product files, Markdown negotiation contract, and command-line tooling without
            guessing private dashboard routes.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20" aria-labelledby="developer-entry-points">
        <h2 className="font-semibold text-3xl tracking-tight" id="developer-entry-points">
          Predictable entry points
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {resources.map((resource) => (
            <article className="flex flex-col rounded-xl border border-border bg-card p-6" key={resource.title}>
              <span className={`${iconTile} size-11`}>
                <resource.icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold text-lg">{resource.title}</h3>
              <p className="mt-2 flex-1 text-muted-foreground text-sm leading-relaxed">{resource.body}</p>
              <a className="mt-5 inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:underline" href={resource.href}>
                {resource.label} <ArrowRight aria-hidden="true" className="size-4" />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="border-border border-y bg-card/40">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-20 lg:grid-cols-2">
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">Call Nibleaf from an agent</h2>
            <ol className="mt-5 space-y-3 text-muted-foreground leading-relaxed">
              <li>1. Read /llms.txt to choose the right product or documentation resource.</li>
              <li>2. Send Accept: text/markdown to a canonical Nibleaf marketing URL when clean page content is needed.</li>
              <li>3. Read /openapi.json before calling the public reader API; preserve typed parameters and operation IDs.</li>
              <li>4. Treat a 404 as a missing path and recover through the sitemap or llms index.</li>
            </ol>
          </div>
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">CLI quick start</h2>
            <pre className="mt-5 overflow-x-auto rounded-xl border border-border bg-background p-5 font-mono text-sm leading-7" dir="ltr">
              <code>{`npx @nibleaf/cli inspect https://nibleaf.com\nnpx @nibleaf/cli fetch https://nibleaf.com/developers`}</code>
            </pre>
            <p className="mt-4 text-muted-foreground text-sm leading-relaxed">
              The CLI uses standard HTTP endpoints and does not collect credentials. Its inspect command checks status, content type, OpenAPI, llms,
              sitemap, Markdown negotiation, and real 404 behavior.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-20">
        <div className="rounded-xl border border-border bg-card p-7 sm:p-9">
          <span className={`${iconTile} size-11`}>
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 font-semibold text-2xl tracking-tight">Authentication and support boundary</h2>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Public published sites require no credentials. Private reader sites use their configured reader session and intentionally return 404 to
            unauthorized callers. Dashboard endpoints use an authenticated browser session and are not a supported third-party write API. Do not send
            session cookies or secrets to the CLI.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className={primaryButton} href="https://docs.nibleaf.com/reference/api">
              Read Nibleaf API documentation <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <a className="inline-flex h-10 items-center gap-2 px-2 font-medium text-primary text-sm hover:underline" href="/contact">
              Contact developer support
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
