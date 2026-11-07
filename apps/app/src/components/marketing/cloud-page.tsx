import { ArrowRight, Check } from 'lucide-react';
import { MarketingShell } from '@/components/cloud-marketing';
import { isRollingOut } from './copy/availability';
import { landingEn } from './copy/landing.en';
import { Eyebrow, outlineButton, primaryButton } from './site/primitives';

/** The Nibleaf Cloud page (`/cloud`). It omits capabilities that are still rolling out or depend on how a deployment is configured. */
export function CloudPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <section className="border-border border-b bg-primary/5">
        <div className="mx-auto max-w-4xl px-5 py-16 sm:px-6 sm:py-24">
          <Eyebrow>Nibleaf Cloud</Eyebrow>
          <h1 className="mt-4 text-balance font-semibold text-4xl leading-tight tracking-tight sm:text-5xl">
            Hosted documentation sites, free during beta
          </h1>
          <p className="mt-5 max-w-[72ch] text-foreground/80 text-lg leading-8">
            Nibleaf managed for you: hosted dashboard, database and storage, upgrades handled for you, and multilingual authoring with first-class
            RTL.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className={primaryButton} href="/sign-up">
              Create free account <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <a className={outlineButton} href="/pricing">
              View pricing
            </a>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-24">
        <Eyebrow>Included</Eyebrow>
        <h2 className="mt-3 font-semibold text-3xl leading-snug">What you get on Nibleaf Cloud</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {landingEn.more.items
            // Capabilities still rolling out stay off this Cloud page until they are live there.
            .filter((item) => !item.deploymentDependent && (!item.availability || !isRollingOut(item.availability)))
            .map((item) => (
              <div key={item.title}>
                <h3 className="flex items-center gap-2 font-semibold">
                  <Check aria-hidden="true" className="size-4 text-primary" />
                  {item.title}
                </h3>
                <p className="mt-3 text-muted-foreground text-sm leading-7">{item.body}</p>
              </div>
            ))}
        </div>
        <div className="mt-12 rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold text-2xl">{landingEn.paths.title}</h2>
          <p className="mt-3 text-muted-foreground leading-7">
            Prefer your own servers? Install the AGPL-3.0 release with Docker Compose. New features reach it when a version that includes them ships.
          </p>
          <a className={`${outlineButton} mt-6`} href="/self-hosting">
            {landingEn.paths.selfHost.cta.label}
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
