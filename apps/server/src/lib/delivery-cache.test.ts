import { describe, expect, it } from 'vitest';
import { deliveryCacheHeaders } from './delivery-cache';

describe('deliveryCacheHeaders', () => {
  it('keeps public responses shared-cacheable', () => {
    expect(deliveryCacheHeaders(false, 'public, s-maxage=60')).toEqual({ 'Cache-Control': 'public, s-maxage=60' });
  });

  it('prevents reader and workspace responses from entering any shared cache', () => {
    expect(deliveryCacheHeaders(true, 'public, max-age=86400')).toEqual({
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Authorization',
    });
  });
});
