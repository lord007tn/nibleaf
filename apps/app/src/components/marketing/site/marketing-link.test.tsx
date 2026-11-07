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
        </>,
      ),
    );
    for (const link of container.querySelectorAll('a')) {
      link.addEventListener('click', (event) => event.preventDefault());
      await act(async () => link.click());
    }
    expect(sendMarketingCtaEvent).toHaveBeenNthCalledWith(1, { destination: 'signup', language: 'ar', placement: 'hero' });
    expect(sendMarketingCtaEvent).toHaveBeenNthCalledWith(2, { destination: 'self_hosting', language: 'en', placement: 'final' });
    expect(sendMarketingCtaEvent).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
