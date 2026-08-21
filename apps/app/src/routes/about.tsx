import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, BookOpen, Globe, Server, Unlock } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { Eyebrow, iconTile, invertedOutlineButton, MarketingShell, primaryButton } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, ENTITY_SENTENCE, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/about')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'About Nibleaf: documentation ownership and Arabic support',
      description:
        'Why Nibleaf exists: a Markdown-based, Arabic-ready documentation platform for teams that want portable content and a clear publishing workflow.',
      path: '/about',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/about') }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'About', path: '/about' },
      ]),
    ],
  }),
  component: AboutPage,
});

const VALUES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { icon: Unlock, title: 'Licensed source', body: 'The public codebase and container release use AGPL-3.0.' },
  { icon: BookOpen, title: 'Portable content', body: 'Pages are stored as Markdown in the database and can be exported as Markdown.' },
  { icon: Globe, title: 'Bilingual by design', body: 'English and Arabic with full RTL — first-class, not bolted on.' },
  {
    icon: Server,
    title: 'Cloud available',
    body: 'Use the free cloud beta now, or run the public AGPL-3.0 release on your own infrastructure.',
  },
];

function AboutPage() {
  const { stars } = Route.useLoaderData();
  return (
    <MarketingShell stars={stars}>
      {/* Header */}
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>About</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Documentation you own, in every language</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">{ENTITY_SENTENCE}</p>
        </div>
      </section>

      {/* Mission */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="font-semibold text-3xl tracking-tight">Why Nibleaf exists</h2>
        <div className="mt-6 space-y-5 text-lg text-muted-foreground leading-relaxed">
          <p>
            Great docs tooling had become something you rent. Your content, search index, analytics, and readers all lived on someone else's servers,
            behind a per-seat bill. Nibleaf focuses on portable Markdown content, a browser editor, and a publishing workflow that teams can inspect.
          </p>
          <p>
            It was built Arabic-first — full right-to-left support and bilingual authoring are core, not an afterthought — so teams working across
            English and Arabic get a first-class experience in both.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-semibold text-3xl tracking-tight">What we stand for</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value) => (
              <div key={value.title} className="rounded-xl border border-border bg-background p-6">
                <span className={`${iconTile} size-11`}>
                  <value.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-lg">{value.title}</h3>
                <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{value.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stack */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="font-semibold text-3xl tracking-tight">Built on a stack you can trust</h2>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
          Postgres, Hono, TanStack Start, BullMQ, Orama search, and S3-compatible storage form the deployment architecture. The public release uses a
          pinned container and guided Docker Compose installer.
        </p>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
          We document those boundaries plainly. Product pages should distinguish shipped behavior from planned work, comparisons should point to
          current primary sources, and technical articles should describe what the code and tests support today. When a claim changes, we correct the
          page and update its review date.
        </p>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{ backgroundImage: 'radial-gradient(var(--background) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
            aria-hidden="true"
          />
          <div className="relative">
            <h2 className="font-semibold text-3xl tracking-tight">Start writing today</h2>
            <p className="mx-auto mt-3 max-w-xl text-background/75">
              Start free on Nibleaf Cloud, or use the public self-hosted release on your own infrastructure.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={`${primaryButton} group`} href="/sign-up">
                Create free account
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
              </a>
              <a className={invertedOutlineButton} href="/self-hosting">
                Self-hosting guide
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
