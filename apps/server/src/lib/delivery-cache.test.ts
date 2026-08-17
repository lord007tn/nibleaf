import { describe, expect, it } from 'vitest';
import { deliveryCacheHeaders, protectPrivateDeliveryFailureResponse } from './delivery-cache';

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

  it('marks indistinguishable not-found delivery failures as private before the global error handler responds', async () => {
    const response = protectPrivateDeliveryFailureResponse(
      '/api/public/sites/private-project',
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie, Authorization');
  });

  it('does not change unrelated API errors', () => {
    const response = protectPrivateDeliveryFailureResponse('/api/app/projects/missing', new Response(null, { status: 404 }));
    expect(response.headers.get('cache-control')).toBeNull();
  });
});
