import { describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';

const mocks = vi.hoisted(() => ({ getSite: vi.fn() }));
vi.mock('@/functions/site', () => ({ getSiteFn: mocks.getSite }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));

import { Route } from './route';

const load = () => {
  const loader = Route.options.loader as (input: {
    params: { projectId: string };
    deps: { lang?: string };
    location: { pathname: string };
  }) => Promise<unknown>;
  return loader({ params: { projectId: 'qa-site' }, deps: { lang: 'ar' }, location: { pathname: '/sites/qa-site/guide' } });
};

describe('published reader failure recovery', () => {
  it('keeps a genuine missing or privacy-hidden publication unavailable', async () => {
    mocks.getSite.mockRejectedValueOnce(new ApiResponseError('Not found', 404));
    await expect(load()).resolves.toEqual({ site: null, siteOrigin: null });
  });
  it.each([429, 500, 503])('preserves HTTP %i failures for the retryable error boundary', async (status) => {
    const error = new ApiResponseError('Temporarily unavailable', status);
    mocks.getSite.mockRejectedValueOnce(error);
    await expect(load()).rejects.toBe(error);
  });
  it('preserves network failures instead of claiming content was never published', async () => {
    const error = new TypeError('fetch failed');
    mocks.getSite.mockRejectedValueOnce(error);
    await expect(load()).rejects.toBe(error);
  });
});
