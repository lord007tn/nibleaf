import { MarketingShell } from '@/components/cloud-marketing';
import { landingEn } from '../copy/landing.en';
import { shellEn } from '../copy/shell.en';
import { LandingView } from './landing-view';

/** The English landing page (`/`). Its own module, so pages that only need `MarketingShell` don't load the landing copy. */
export function LandingPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <LandingView lang="en" copy={landingEn} stars={stars} starsLabel={shellEn.github.starsLabel} />
    </MarketingShell>
  );
}
