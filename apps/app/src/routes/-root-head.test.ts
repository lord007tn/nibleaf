import { describe, expect, it } from 'vitest';
import { Route } from './__root';

type Head = { meta?: Array<Record<string, string>>; links?: Array<Record<string, string>> };
const head = (routeIds: string[]) =>
  (Route.options.head as (context: { matches: Array<{ routeId: string }> }) => Head)({ matches: routeIds.map((routeId) => ({ routeId })) });

describe('root document head', () => {
  it('keeps Nibleaf branding on product and marketing pages', () => {
    const product = head(['__root__', '/app']);
    expect(product.meta).toContainEqual({ name: 'theme-color', content: '#181612' });
    expect(product.links?.map((link) => link.rel)).toEqual(['stylesheet', 'icon', 'icon', 'apple-touch-icon', 'manifest']);
  });

  it('leaves a published docs site free of Nibleaf’s title, icons, manifest and theme color', () => {
    const reader = head(['__root__', '/sites/$projectId', '/sites/$projectId/$']);
    expect(reader.links?.map((link) => link.rel)).toEqual(['stylesheet']);
    expect(reader.meta).toEqual([{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }]);
  });
});
