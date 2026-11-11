import { describe, expect, it } from 'vitest';
import { apiResponseErrorAdapter } from './api-error-serialization';
import { ApiResponseError } from './client-helpers';

const roundTrip = (error: ApiResponseError) =>
  apiResponseErrorAdapter.fromSerializable(JSON.parse(JSON.stringify(apiResponseErrorAdapter.toSerializable(error))));

describe('apiResponseErrorAdapter', () => {
  it('claims API errors only', () => {
    expect(apiResponseErrorAdapter.test(new ApiResponseError('Forbidden', 403))).toBe(true);
    expect(apiResponseErrorAdapter.test(new Error('plain'))).toBe(false);
    expect(apiResponseErrorAdapter.test({ status: 403 })).toBe(false);
  });

  it('keeps the status, code, Retry-After and details through JSON', () => {
    const original = new ApiResponseError('Too many requests', 429, 'rate_limited', '30', '/docs/a', 'a.mdx', 5, {
      reason: 'pending_asset_upload_limit',
      stage: 2,
    });
    const restored = roundTrip(original);
    expect(restored).toBeInstanceOf(ApiResponseError);
    expect(restored).toMatchObject({
      name: 'ApiResponseError',
      message: 'Too many requests',
      status: 429,
      code: 'rate_limited',
      retryAfter: '30',
      path: '/docs/a',
      sourceFile: 'a.mdx',
      limit: 5,
      details: { reason: 'pending_asset_upload_limit', stage: 2 },
    });
    expect(restored.reason).toBe('pending_asset_upload_limit');
  });

  it('restores absent fields as absent, and ignores details that are not an object', () => {
    const restored = roundTrip(new ApiResponseError('Not found', 404));
    expect(restored).toMatchObject({ status: 404, code: undefined, retryAfter: undefined, limit: undefined, details: undefined });
    expect(
      apiResponseErrorAdapter.fromSerializable({ ...apiResponseErrorAdapter.toSerializable(new ApiResponseError('x', 500)), details: '[1]' }).details,
    ).toBeUndefined();
    expect(
      apiResponseErrorAdapter.fromSerializable({ ...apiResponseErrorAdapter.toSerializable(new ApiResponseError('x', 500)), details: '{' }).details,
    ).toBeUndefined();
  });
});
