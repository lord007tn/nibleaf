import { pricingAr } from './copy/pricing.ar';
import { shellAr } from './copy/shell.ar';
import { PricingView } from './pricing-view';
import { MarketingSiteShell } from './site/marketing-site-shell';

/**
 * `/ar/pricing`: the pricing view with the Arabic copy, in the Arabic shell.
 * Its own module, so only this route's chunk loads the Arabic pricing copy;
 * the language switch opens `/pricing`.
 */
export function ArabicPricingPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingSiteShell lang="ar" copy={shellAr} alternateHref="/pricing" stars={stars}>
      <PricingView copy={pricingAr} lang="ar" />
    </MarketingSiteShell>
  );
}
