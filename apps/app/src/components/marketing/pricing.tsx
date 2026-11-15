import { MarketingShell } from '@/components/cloud-marketing';
import { pricingEn } from './copy/pricing.en';
import { PricingView } from './pricing-view';

/** `/pricing`. The Arabic page (`arabic-pricing-page.tsx`) renders the same view with its own copy. */
export function PricingPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <PricingView copy={pricingEn} lang="en" />
    </MarketingShell>
  );
}
