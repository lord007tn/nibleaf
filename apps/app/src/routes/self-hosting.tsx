import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Boxes, DatabaseBackup, Network, PackageCheck } from 'lucide-react';
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
            anonymous access. The installer therefore cannot complete a public deployment. We will not describe that flow as production-ready until a
            new user can fetch both resources without private credentials.
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

      <section className="mx-auto max-w-5xl px-6 py-20" aria-labelledby="deployment-architecture">
        <h2 className="font-semibold text-3xl tracking-tight" id="deployment-architecture">
          What the deployment contains
        </h2>
        <p className="mt-4 max-w-3xl text-muted-foreground leading-relaxed">
          The Compose design runs several cooperating services. Understanding those boundaries matters before choosing a host, estimating memory, or
          writing a recovery plan.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {[
            {
              icon: Boxes,
              title: 'Application and workers',
              body: 'The web application serves the editor, marketing pages, API, and published sites. Background workers handle asynchronous jobs.',
            },
            {
              icon: DatabaseBackup,
              title: 'PostgreSQL and Redis',
              body: 'PostgreSQL stores application data. Redis supports queues and coordination. Both need durable storage and an explicit recovery procedure.',
            },
            {
              icon: PackageCheck,
              title: 'Object storage',
              body: 'An S3-compatible service stores uploaded assets. Backups must cover the database and object storage from the same recovery point.',
            },
            {
              icon: Network,
              title: 'Ingress and DNS',
              body: 'TLS, the main application hostname, project subdomains, and custom domains depend on correctly configured ingress and DNS records.',
            },
          ].map((item) => (
            <article className="rounded-xl border border-border bg-card p-6" key={item.title}>
              <item.icon aria-hidden="true" className="size-5 text-primary" />
              <h3 className="mt-4 font-semibold text-lg">{item.title}</h3>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="font-semibold text-3xl tracking-tight">What to verify before serving readers</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            A successful container start is only the first check. Publish a disposable test project, confirm its canonical URL and sitemap, upload and
            retrieve an asset, exercise a background job, and restore both data stores into a clean environment. Test a missing page too: it must
            return an actual HTTP 404 rather than a 200 response with a not-found message.
          </p>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Keep the application image pinned to a release or digest, record every required environment variable, and monitor the health endpoint
            during upgrades. The public installer will return only after the same path works for a new operator without private registry credentials.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
