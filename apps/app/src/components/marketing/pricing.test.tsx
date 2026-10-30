// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PricingPage } from './pricing';

it('states what Cloud and self-hosted share without promising every feature in both', () => {
  const html = renderToStaticMarkup(<PricingPage />);
  expect(html).toContain('Same core product, different operations');
  expect(html).toContain('depend on the release you install');
  expect(html).toContain('Pull the new release and follow its upgrade notes');
  expect(html).toContain('Interface in 12 languages; English and Arabic authoring with full RTL');
  expect(html).not.toContain('Every feature, both plans');
  expect(html).not.toContain('60 seconds');
});
