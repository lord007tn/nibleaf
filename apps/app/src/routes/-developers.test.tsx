// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DeveloperResourcesPage } from './developers';

it('publishes named Nibleaf developer and agent entry points with an explicit auth boundary', () => {
  const html = renderToStaticMarkup(<DeveloperResourcesPage />);
  expect(html).toContain('Nibleaf developer resources');
  expect(html).toContain('href="/openapi.json"');
  expect(html).toContain('href="/llms.txt"');
  expect(html).toContain('not a supported third-party write API');
});

it('points to the CLI source instead of an unpublished npm package', () => {
  const html = renderToStaticMarkup(<DeveloperResourcesPage />);
  expect(html).toContain('Nibleaf CLI (source only)');
  expect(html).toContain('href="https://github.com/lord007tn/nibleaf/tree/main/packages/cli"');
  expect(html).toContain('curl -s https://nibleaf.com/llms.txt');
  expect(html).not.toContain('npx @nibleaf/cli');
  expect(html).not.toContain('npmjs.com');
});
