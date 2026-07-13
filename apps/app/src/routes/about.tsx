import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, BookOpen, Globe, Server, Unlock } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { Eyebrow, iconTile, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, ENTITY_SENTENCE, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/about')({
  head: () => ({
    meta: pageMeta({
      title: 'About Nibleaf — why we built an open-source docs platform',
      description:
        'Why Nibleaf exists: an open-source, self-hostable, Arabic-first documentation platform for teams who want to own their content and their readers.',
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
  { icon: Unlock, title: 'Open source', body: 'AGPL-3.0, developed in the open. Read it, fork it, extend it.' },
  { icon: BookOpen, title: 'You own everything', body: "Your content is plain Markdown, and your readers' data lives in your database and storage." },
  { icon: Globe, title: 'Bilingual by design', body: 'English and Arabic with full RTL — first-class, not bolted on.' },
  { icon: Server, title: 'Cloud or your servers', body: 'Use the free cloud beta, or self-host the same platform with one docker compose.' },
];

function AboutPage() {
  return (
    <MarketingShell>
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
            behind a per-seat bill. Nibleaf is the alternative: the same polished authoring experience, open source and yours to run.
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
          Postgres, Hono, TanStack Start, BullMQ, Orama search, and S3-compatible storage — modern, boring-in-a-good-way infrastructure you can run
          yourself.
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
            <p className="mx-auto mt-3 max-w-xl text-background/75">Start free on Nibleaf Cloud, or self-host the open-source platform.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={`${primaryButton} group`} href="/sign-up">
                Get started free
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
              </a>
              <a className={`${outlineButton} border-background/25 bg-transparent text-background hover:bg-background/10`} href="/self-hosting">
                Explore self-hosting
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
