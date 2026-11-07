import { ArrowRight, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { landingEn } from './marketing/copy/landing.en';
import { shellEn } from './marketing/copy/shell.en';
import { LandingView } from './marketing/landing/landing-view';
import { MarketingSiteShell } from './marketing/site/marketing-site-shell';
import { Eyebrow, outlineButton, primaryButton } from './marketing/site/primitives';

export { GitHubStarLink } from './marketing/site/github-star-link';
export { Eyebrow, iconTile, invertedOutlineButton, outlineButton, primaryButton } from './marketing/site/primitives';

export function MarketingShell({ children, stars = 0 }: { children: ReactNode; stars?: number }) {
  return (
    <MarketingSiteShell lang="en" copy={shellEn} alternateHref="/ar" stars={stars}>
      {children}
    </MarketingSiteShell>
  );
}

export function LandingPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <LandingView lang="en" copy={landingEn} stars={stars} />
    </MarketingShell>
  );
}

export function CloudPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <section className="border-border border-b bg-primary/5">
        <div className="mx-auto max-w-4xl px-5 py-16 sm:px-6 sm:py-24">
          <Eyebrow>Nibleaf Cloud</Eyebrow>
          <h1 className="mt-4 text-balance font-semibold text-4xl leading-tight tracking-tight sm:text-5xl">
            Hosted documentation sites, free during beta
          </h1>
          <p className="mt-5 max-w-[72ch] text-lg text-muted-foreground leading-8">
            Nibleaf managed for you: hosted dashboard, database and storage, automatic upgrades, custom domains, analytics, and multilingual authoring
            with first-class RTL.
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
        <Eyebrow>{landingEn.more.eyebrow}</Eyebrow>
        <h2 className="mt-3 font-semibold text-3xl leading-snug">{landingEn.more.title}</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {landingEn.more.items.map((item) => (
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
          <p className="mt-3 text-muted-foreground leading-7">{landingEn.paths.body}</p>
          <a className={`${outlineButton} mt-6`} href="/self-hosting">
            {landingEn.paths.selfHost.cta.label}
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
