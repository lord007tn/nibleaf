import { describe, expect, it } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { importMayStillRun } from './import-errors';

describe('uncertain import outcomes', () => {
  it.each([502, 503, 504, 408])('warns after HTTP %s', (status) => {
    expect(importMayStillRun(new ApiResponseError('proxy', status))).toBe(true);
  });
  it('warns after network failures and invalid proxy responses', () => {
    expect(importMayStillRun(new TypeError('fetch failed'))).toBe(true);
    expect(importMayStillRun(new SyntaxError('Unexpected token'))).toBe(true);
  });
  it.each([400, 401, 403, 409, 422, 429, 500])('keeps a definite HTTP %s error', (status) => {
    expect(importMayStillRun(new ApiResponseError('rejected', status))).toBe(false);
  });
});

it.each([408, 500, 502, 503, 504])('keeps an application error envelope with status %s definite', (status) => {
  expect(importMayStillRun(new ApiResponseError('failed', status, 'http:internal'))).toBe(false);
});
