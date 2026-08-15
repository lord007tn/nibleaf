import { createFileRoute } from '@tanstack/react-router';
import { MarketingShell } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: pageMeta({
      title: 'Terms of Service — Nibleaf',
      description: 'The terms governing your use of Nibleaf Cloud and the Nibleaf open-source edition.',
      path: '/terms',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/terms') }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Terms of Service', path: '/terms' },
      ]),
    ],
  }),
  component: TermsPage,
});

const LAST_UPDATED = 'August 15, 2026';

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: '1. Acceptance of terms',
    body: 'By accessing or using Nibleaf Cloud or the Nibleaf open-source edition (the "Service") you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service. Teams running their own deployment should review and adapt these terms with their own legal counsel.',
  },
  {
    heading: '2. Free beta',
    body: 'Nibleaf Cloud is currently in a free beta. During the beta the Service is provided as-is and as-available: features may change, and while we work hard to keep your content safe and the service up, we do not yet offer uptime or support guarantees. There are no paid plans today. Public self-hosting distribution is currently unavailable.',
  },
  {
    heading: '3. Your content',
    body: 'You retain all rights to the documentation and other content you create on the Service. You grant us only the limited rights needed to host, store, back up, and serve that content — including publishing it publicly when you choose to publish a site. You can export your content (it is stored as plain Markdown) and delete it at any time.',
  },
  {
    heading: '4. The open-source license',
    body: "Nibleaf is distributed under the GNU Affero General Public License v3.0 (AGPL-3.0). The license that ships with the source code governs your rights to use, copy, modify, and distribute the software, and — under the AGPL's network-use clause — to receive the corresponding source of any modified version offered to you over a network. Nothing in these terms limits the rights granted to you under that open-source license.",
  },
  {
    heading: '5. Cloud and self-hosted deployments',
    body: 'For Nibleaf Cloud, your workspace content, account data, and published sites are processed to provide the hosted service, as described in the Privacy Policy. When you run the open-source edition yourself, you are responsible for your own infrastructure, configuration, data, security, and compliance.',
  },
  {
    heading: '6. Acceptable use',
    body: 'You agree not to use the Service to violate any law, infringe the rights of others, distribute unlawful, harmful, or malicious content, send spam, host phishing pages or malware, or attempt to disrupt the Service or access other users’ data. We may suspend or remove content or accounts that violate this policy. To report abuse on a Nibleaf-hosted site, email abuse@nibleaf.com.',
  },
  {
    heading: '7. Limitation of liability',
    body: 'To the fullest extent permitted by law, the authors and copyright holders shall not be liable for any claim, damages, or other liability arising from the use of the Service.',
  },
  {
    heading: '8. Changes to these terms',
    body: 'We may update these terms from time to time. Material changes will be reflected by the "last updated" date above, and continued use of the Service after changes take effect constitutes acceptance of the revised terms.',
  },
  {
    heading: '9. Contact',
    body: 'Questions about these terms or the Service: support@nibleaf.com. Security vulnerabilities: security@nibleaf.com. Abuse reports: abuse@nibleaf.com.',
  },
];

function TermsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-semibold text-4xl tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-muted-foreground text-sm">Last updated: {LAST_UPDATED}</p>
        <div className="mt-10 space-y-8 text-muted-foreground leading-relaxed">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-semibold text-foreground text-xl tracking-tight">{section.heading}</h2>
              <p className="mt-3">{section.body}</p>
            </section>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
