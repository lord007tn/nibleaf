import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, BookOpenCheck, LifeBuoy, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Eyebrow, iconTile, MarketingShell, primaryButton } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';

const CONTACTS = [
  {
    icon: LifeBuoy,
    title: 'Product support',
    address: 'support@nibleaf.com',
    linkLabel: 'Email product support',
    body: 'Questions about Nibleaf Cloud, publishing, workspaces, imports, billing during beta, or self-hosted deployment.',
  },
  {
    icon: LockKeyhole,
    title: 'Privacy requests',
    address: 'privacy@nibleaf.com',
    linkLabel: 'Email the privacy team',
    body: 'Questions about personal data, retention, subprocessors, account access, or a deletion request.',
  },
  {
    icon: ShieldCheck,
    title: 'Security reports',
    address: 'security@nibleaf.com',
    linkLabel: 'Email the security team',
    body: 'Potential vulnerabilities, exposed credentials, authentication problems, or other security-sensitive reports.',
  },
  {
    icon: AlertTriangle,
    title: 'Abuse reports',
    address: 'abuse@nibleaf.com',
    linkLabel: 'Email the abuse team',
    body: 'Phishing, unlawful content, impersonation, malware, or another misuse of a site published through Nibleaf.',
  },
] as const;

export const Route = createFileRoute('/contact')({
  head: () => ({
    meta: pageMeta({
      title: 'Contact Nibleaf: support, privacy, security, and corrections',
      description:
        'Contact Nibleaf for product support, privacy requests, security disclosures, abuse reports, or corrections to our documentation articles.',
      path: '/contact',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/contact') }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Contact', path: '/contact' },
      ]),
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'ContactPage',
          name: 'Contact Nibleaf',
          url: canonicalHref('/contact'),
          mainEntity: {
            '@type': 'Organization',
            name: 'Nibleaf',
            url: canonicalHref('/'),
            contactPoint: CONTACTS.map((contact) => ({
              '@type': 'ContactPoint',
              contactType: contact.title,
              email: contact.address,
              availableLanguage: ['English', 'Arabic'],
            })),
          },
        }),
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <MarketingShell>
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>Contact</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">Reach the right Nibleaf inbox</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">
            Choose the address that matches your request. Clear routing helps us keep product questions separate from privacy, security, and abuse
            reports.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20" aria-labelledby="contact-options">
        <h2 className="font-semibold text-3xl tracking-tight" id="contact-options">
          Contact options
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {CONTACTS.map((contact) => (
            <article className="rounded-xl border border-border bg-card p-6" key={contact.address}>
              <span className={`${iconTile} size-11`}>
                <contact.icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold text-lg">{contact.title}</h3>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{contact.body}</p>
              <a
                className="mt-4 inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:underline"
                href={`mailto:${contact.address}`}
              >
                {contact.linkLabel}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="border-border border-y bg-card/40">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-6 py-20 md:grid-cols-2">
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">Include enough context</h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              For a product problem, include the affected public URL or workspace name, the action you attempted, what you expected, what happened,
              and the browser or device you used. A short sequence of reproducible steps is more useful than a screenshot alone.
            </p>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Do not email passwords, session cookies, API keys, recovery codes, or full database exports. If a report involves sensitive account or
              security information, use the privacy or security address above and share only what is necessary to investigate it.
            </p>
          </div>
          <div>
            <h2 className="font-semibold text-2xl tracking-tight">Corrections and editorial questions</h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              We welcome corrections to product claims, comparisons, technical guidance, and translations. Send the article URL, quote the sentence
              that needs attention, and link to a primary source when one is available. We review factual corrections separately from sales or
              partnership requests.
            </p>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Messages can be written in English or Arabic. If a correction changes a published claim, we update the article and its modification date
              so readers can see that the page was reviewed again.
            </p>
            <a
              className="mt-5 inline-flex items-center gap-2 font-medium text-primary hover:underline"
              href="mailto:support@nibleaf.com?subject=Article%20correction"
            >
              <BookOpenCheck aria-hidden="true" className="size-4" />
              Send an article correction
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="font-semibold text-3xl tracking-tight">Checking self-hosting availability?</h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground leading-relaxed">
          The codebase is AGPL-licensed with a public source repository and container release. Review the deployment guide before planning an
          installation, migration, backup policy, or DNS change.
        </p>
        <a className={`${primaryButton} mt-7`} href="/self-hosting">
          View self-hosting guide <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </section>
    </MarketingShell>
  );
}
