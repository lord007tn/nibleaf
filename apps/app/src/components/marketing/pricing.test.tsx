// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PricingPage } from './pricing';

it('states what Cloud and self-hosted share without promising every feature in both', () => {
  const html = renderToStaticMarkup(<PricingPage />);
  expect(html).toContain('Same core product, different operations');
  expect(html.replace(/\s+/g, ' ')).toContain('available when you self-host today, and on Nibleaf Cloud as it rolls out.');
  expect(html).toContain('Pull the new release and follow its upgrade notes');
  expect(html).toContain('English and Arabic authoring with RTL; 12 interface locales, with some strings still in English');
  expect(html).not.toContain('Every feature, both plans');
  expect(html).not.toContain('60 seconds');
  expect(html).not.toMatch(/no billing code|Everything stays on your infra|preferential treatment|Priority treatment|Generous notice/);
  expect(html).toContain('AI request/token budgets');
  expect(html).toContain('No paid cloud plan today');
  expect(html).toContain('workspace or instance AI provider key');
  expect(html.replace(/\s+/g, ' ')).toContain('publish only after a confirmed preview');
});
