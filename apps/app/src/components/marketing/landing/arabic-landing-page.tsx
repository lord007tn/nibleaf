import { ArabicShell } from '../arabic-shell';
import { landingAr } from '../copy/landing.ar';
import { shellAr } from '../copy/shell.ar';
import { LandingView } from './landing-view';

/** The Arabic landing page (`/ar`). Its own module, so other Arabic pages don't load the landing copy. */
export function ArabicLandingPage({ stars = 0 }: { stars?: number }) {
  return (
    <ArabicShell stars={stars}>
      <LandingView lang="ar" copy={landingAr} stars={stars} starsLabel={shellAr.github.starsLabel} />
    </ArabicShell>
  );
}
