// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PricingPage } from './pricing';

it('states what Cloud and self-hosted share without promising every feature in both', () => {
  const html = renderToStaticMarkup(<PricingPage />);
  expect(html).toContain('Same core product, different operations');
  expect(html).toContain('depend on the release in use');
  expect(html).toContain('Pull the new release and follow its upgrade notes');
  expect(html).toContain('English and Arabic authoring with RTL; 12 interface locales, with some strings still in English');
  expect(html).not.toContain('Every feature, both plans');
  expect(html).not.toContain('60 seconds');
});
