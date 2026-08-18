import { createFileRoute } from '@tanstack/react-router';
import { MarketingShell } from '@/components/cloud-marketing';
import { breadcrumbLd, canonicalHref, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/privacy')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf Cloud Privacy Policy and Data Practices',
      description: 'How Nibleaf Cloud handles account and documentation data, analytics, subprocessors, retention, security, and deletion requests.',
      path: '/privacy',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/privacy') }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Privacy Policy', path: '/privacy' },
      ]),
    ],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = 'August 15, 2026';

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: '1. Your data stays yours',
    body: "For Nibleaf Cloud, your content and account data are used only to provide hosting, publishing, search, analytics, authentication, and support. We do not sell your data or use it for advertising. A separately operated self-hosted deployment is governed by its operator's privacy practices.",
  },
  {
    heading: '2. What we collect',
    body: 'We collect the information needed to operate Nibleaf Cloud: account details (name, email, and a hashed password or your Google account identifier), workspace and project metadata, the documentation content you author, published-site analytics, product usage events (such as sign-up, editing, and publishing activity) that we use to operate and improve the service, support communications, and session data — including IP addresses and browser user-agent — used for authentication and to protect accounts against abuse.',
  },
  {
    heading: '3. Where your data lives',
    body: 'Nibleaf Cloud is hosted in the European Union. Your account data, documentation content, and uploaded assets are stored on servers located in the EU.',
  },
  {
    heading: '4. Subprocessors',
    body: 'We use a small number of infrastructure providers to run the Service: Hetzner Online GmbH (server hosting in the EU, where application data is stored), Cloudflare (DNS, traffic delivery, security, and aggregate web telemetry), Postmark / ActiveCampaign (transactional email such as sign-in verification and invitations), and OpenAI (processes document text only when a user explicitly invokes the AI writing assistant). We will update this list before adding a new subprocessor.',
  },
  {
    heading: '5. Built-in analytics',
    body: 'Nibleaf includes first-party analytics for your published sites, such as page views, unique visitors, top pages, and searches. These analytics power the product experience and do not require a third-party analytics provider. Site owners can additionally configure their own analytics for their published sites.',
  },
  {
    heading: '6. Cookies',
    body: 'Authentication uses first-party session cookies and related security cookies to keep you signed in and protect your account. We do not use third-party advertising or tracking cookies.',
  },
  {
    heading: '7. Account deletion and data requests',
    body: 'You can delete projects and workspaces from the dashboard at any time, which removes their content and published sites. To delete your account entirely, or for access, correction, or export requests, email privacy@nibleaf.com and we will action the request. Backups expire on a rolling basis after deletion.',
  },
  {
    heading: '8. Changes to this policy',
    body: 'We may update this policy from time to time. Material changes will be reflected by the "last updated" date above.',
  },
  {
    heading: '9. Contact',
    body: 'For any privacy question or request, contact privacy@nibleaf.com.',
  },
];

function PrivacyPage() {
  const { stars } = Route.useLoaderData();
  return (
    <MarketingShell stars={stars}>
      <article className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-semibold text-4xl tracking-tight">Privacy Policy</h1>
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
