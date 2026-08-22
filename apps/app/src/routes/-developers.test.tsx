// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DeveloperResourcesPage } from './developers';

it('publishes named Nibleaf developer and agent entry points with an explicit auth boundary', () => {
  const html = renderToStaticMarkup(<DeveloperResourcesPage />);
  expect(html).toContain('Nibleaf developer resources');
  expect(html).toContain('href="/openapi.json"');
  expect(html).toContain('href="/llms.txt"');
  expect(html).toContain('@nibleaf/cli');
  expect(html).toContain('not a supported third-party write API');
});
