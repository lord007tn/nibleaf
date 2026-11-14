// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { sendMarketingCtaEvent } from '@/lib/marketing-analytics';
import { MarketingLink } from './marketing-link';

vi.mock('@/lib/marketing-analytics', () => ({ sendMarketingCtaEvent: vi.fn() }));

it('tracks allowed CTA destinations and placements without classifying arbitrary links', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <>
          <MarketingLink cta={{ href: '/sign-up', label: 'Start' }} lang="ar" placement="hero" />
          <MarketingLink cta={{ href: '/self-hosting', label: 'Install' }} lang="en" placement="final" />
          <MarketingLink cta={{ href: '/blog', label: 'Articles' }} lang="en" placement="resource_bridge" />
          <MarketingLink cta={{ href: '/ar/pricing', label: 'الأسعار' }} lang="ar" placement="final" />
          <MarketingLink cta={{ href: 'https://docs.nibleaf.com?lang=ar', label: 'الوثائق' }} lang="ar" placement="hero" />
          <MarketingLink cta={{ href: 'https://example.com/sign-up', label: 'Elsewhere' }} lang="en" placement="hero" />
        </>,
      ),
    );
    for (const link of container.querySelectorAll('a')) {
      link.addEventListener('click', (event) => event.preventDefault());
      await act(async () => link.click());
    }
    await vi.waitFor(() => expect(sendMarketingCtaEvent).toHaveBeenCalledTimes(4));
    expect(sendMarketingCtaEvent).toHaveBeenNthCalledWith(1, { destination: 'signup', language: 'ar', placement: 'hero' });
    expect(sendMarketingCtaEvent).toHaveBeenNthCalledWith(2, { destination: 'self_hosting', language: 'en', placement: 'final' });
    expect(sendMarketingCtaEvent).toHaveBeenNthCalledWith(3, { destination: 'pricing', language: 'ar', placement: 'final' });
    expect(sendMarketingCtaEvent).toHaveBeenNthCalledWith(4, { destination: 'docs', language: 'ar', placement: 'hero' });
    expect(sendMarketingCtaEvent).toHaveBeenCalledTimes(4);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
