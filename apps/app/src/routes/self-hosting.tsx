import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { Eyebrow, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/self-hosting')({
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf self-hosting status and deployment architecture',
      description:
        'Current Nibleaf self-hosting availability, the Docker Compose architecture, and the public distribution checks required before installation.',
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

function SelfHostingPage() {
  return (
    <MarketingShell>
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <Eyebrow>Self-hosting status</Eyebrow>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Public installation is temporarily unavailable</h1>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            Nibleaf has an AGPL-3.0 codebase and a Docker Compose deployment design, but the source repository and GHCR container currently reject
            anonymous access. The installer therefore cannot complete a public deployment. We will not describe that flow as production-ready until
            a new user can fetch both resources without private credentials.
          </p>
          <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
            <h2 className="font-semibold text-xl">Readiness checks still required</h2>
            <ul className="mt-4 space-y-2 text-muted-foreground text-sm leading-relaxed">
              <li>Anonymous repository clone succeeds.</li>
              <li>Anonymous container pull succeeds for a pinned release tag.</li>
              <li>The installer completes on a clean Linux host.</li>
              <li>Backup and restore are tested for PostgreSQL and object storage.</li>
              <li>Wildcard DNS and ingress resolve published project subdomains.</li>
            </ul>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className={primaryButton} href="/sign-up">
              Use Nibleaf Cloud <ArrowRight className="size-4" />
            </a>
            <a className={outlineButton} href="/blog/self-host-documentation-site-docker-compose">
              Read the architecture guide
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
