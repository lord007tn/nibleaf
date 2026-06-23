import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [{ title: 'Terms of Service — Plume' }, { name: 'description', content: 'The terms governing your use of Plume.' }],
  }),
  component: TermsPage,
});

const LAST_UPDATED = 'June 19, 2026';

function TermsPage() {
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl px-6 py-20">
        <a className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground" href="/">
          <ArrowLeft className="size-4" /> Back to home
        </a>
        <h1 className="mt-8 font-semibold text-4xl tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-muted-foreground text-sm">Last updated: {LAST_UPDATED}</p>

        <div className="mt-10 space-y-8 text-muted-foreground leading-relaxed">
          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">1. Acceptance of terms</h2>
            <p className="mt-3">
              By accessing or using Plume (the "Service") you agree to be bound by these Terms of Service. If you do not agree to these terms, do not
              use the Service. As Plume is self-hosted software, the operator of each deployment should review and adapt these terms with their own
              legal counsel.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">2. The open-source license</h2>
            <p className="mt-3">
              Plume is distributed under the GNU Affero General Public License v3.0 (AGPL-3.0). The license that ships with the source code governs
              your rights to use, copy, modify, and distribute the software, and — under the AGPL's network-use clause — to receive the corresponding
              source of any modified version offered to you over a network. Nothing in these terms limits the rights granted to you under that
              open-source license.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">3. Self-hosted deployments</h2>
            <p className="mt-3">
              When you self-host Plume, you are solely responsible for your own infrastructure, configuration, data, security, and compliance. The
              Service is provided "as is" without warranties of any kind, to the maximum extent permitted by applicable law.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">4. Acceptable use</h2>
            <p className="mt-3">
              You agree not to use the Service to violate any law, infringe the rights of others, or distribute unlawful, harmful, or malicious
              content. Replace this section with the specific policies that apply to your deployment.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">5. Limitation of liability</h2>
            <p className="mt-3">
              To the fullest extent permitted by law, the authors and copyright holders shall not be liable for any claim, damages, or other liability
              arising from the use of the Service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground text-xl tracking-tight">6. Changes to these terms</h2>
            <p className="mt-3">
              We may update these terms from time to time. Continued use of the Service after changes take effect constitutes acceptance of the
              revised terms.
            </p>
          </section>
        </div>

        <div className="mt-12 border-border border-t pt-8">
          <a className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground" href="/">
            <ArrowLeft className="size-4" /> Back to home
          </a>
        </div>
      </main>
    </div>
  );
}
