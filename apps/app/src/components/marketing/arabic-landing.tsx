import type { ReactNode } from 'react';
import { landingAr } from './copy/landing.ar';
import { shellAr } from './copy/shell.ar';
import { LandingView } from './landing/landing-view';
import { MarketingSiteShell } from './site/marketing-site-shell';

/**
 * The Arabic marketing shell and landing page. Kept apart from
 * `arabic-seo.tsx` (the platform comparison) on purpose: nothing here imports
 * the interface message catalog, so `/ar` and every page wrapped in this shell
 * load only their own Arabic copy module.
 */
export function ArabicShell({ children, englishHref = '/', stars = 0 }: { children: ReactNode; englishHref?: string; stars?: number }) {
  return (
    <MarketingSiteShell lang="ar" copy={shellAr} alternateHref={englishHref} stars={stars}>
      {children}
    </MarketingSiteShell>
  );
}

export function ArabicLandingPage({ stars = 0 }: { stars?: number }) {
  return (
    <ArabicShell stars={stars}>
      <LandingView lang="ar" copy={landingAr} stars={stars} />
    </ArabicShell>
  );
}
