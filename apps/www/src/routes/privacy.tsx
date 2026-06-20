import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [
      { title: 'Privacy Policy — Plume' },
      { name: 'description', content: 'How Plume handles your data.' },
    ],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = 'June 19, 2026';

function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl px-6 py-20">
        <a
          className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
          href="/"
        >
          <ArrowLeft className="size-4" /> Back to home
        </a>
        <h1 className="mt-8 font-semibold text-4xl tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-muted-foreground text-sm">Last updated: {LAST_UPDATED}</p>

        <div className="mt-10 space-y-8 text-muted-foreground leading-relaxed">
          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">1. Your data stays yours</h2>
            <p className="mt-3">
              Plume is self-hosted by design. When you run Plume on your own infrastructure, your
              content and your users' data live in your own database and object storage — not ours.
              This is placeholder copy; replace it with a policy reviewed by your own legal counsel.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">2. What we collect</h2>
            <p className="mt-3">
              The marketing site itself does not use third-party analytics or trackers. Any data
              processed by your Plume deployment is governed by the privacy policy you publish to your
              own users, not by this document.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">3. Built-in analytics</h2>
            <p className="mt-3">
              Plume includes first-party analytics (page views, unique visitors, top pages and
              searches) that run entirely within your deployment. No data is sent to any external
              analytics provider unless you configure one.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">4. Cookies</h2>
            <p className="mt-3">
              Authentication uses first-party session cookies issued by your own deployment. Document
              the specific cookies your instance sets when you adapt this policy for production.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">5. Data requests</h2>
            <p className="mt-3">
              Because you control the infrastructure, you are the data controller for your deployment.
              Provide your own contact details and process for handling access, correction, and
              deletion requests here.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">6. Changes to this policy</h2>
            <p className="mt-3">
              We may update this policy from time to time. Material changes will be reflected by the
              "last updated" date above.
            </p>
          </section>
        </div>

        <div className="mt-12 border-border border-t pt-8">
          <a
            className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
            href="/"
          >
            <ArrowLeft className="size-4" /> Back to home
          </a>
        </div>
      </main>
    </div>
  );
}
