import { H3 } from 'nitro/h3';
import { describe, expect, it } from 'vitest';
import assetNotFound from './asset-not-found.server';

// The built app is checked end to end by scripts/check-asset-cache.mjs in CI,
// where the `/assets/**` route rule and Nitro's static files are real.
describe('missing build assets', () => {
  const app = new H3().all('/assets/**', assetNotFound);

  it.each(['/assets/missing-DmVhZ3Nz.js', '/assets/missing.json'])('answers %s with a 404 nothing stores', async (path) => {
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request(path, { method });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-nibleaf-static-build')).toBeNull();
    }
  });
});
