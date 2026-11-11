import { describe, expect, it } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { MAX_RECOVERY_WAIT_MS, navigationRecoveryDelay, PageTransportError, retryAfterMs } from './page-load-error';

const NOW = Date.parse('2026-11-11T10:00:00Z');

describe('navigationRecoveryDelay', () => {
  it('never recovers from a refusal, a 500, or an error that is not a request failure', () => {
    for (const status of [400, 401, 403, 404, 410, 429]) {
      expect(navigationRecoveryDelay(new ApiResponseError('refused', status), NOW)).toBeNull();
      expect(navigationRecoveryDelay(new PageTransportError(status), NOW)).toBeNull();
    }
    expect(navigationRecoveryDelay(new ApiResponseError('server', 500), NOW)).toBeNull();
    expect(navigationRecoveryDelay(new PageTransportError(500), NOW)).toBeNull();
    expect(navigationRecoveryDelay(new TypeError('Failed to fetch dynamically imported module'), NOW)).toBeNull();
    expect(navigationRecoveryDelay(undefined, NOW)).toBeNull();
    // Status 0 only means "unreachable" when the transport said so.
    expect(navigationRecoveryDelay(new ApiResponseError('odd', 0), NOW)).toBeNull();
  });

  it('recovers right away from a dropped request or a gateway 502, 503 or 504', () => {
    expect(navigationRecoveryDelay(new PageTransportError(0), NOW)).toBe(0);
    for (const status of [502, 503, 504]) {
      expect(navigationRecoveryDelay(new PageTransportError(status), NOW)).toBe(0);
      expect(navigationRecoveryDelay(new ApiResponseError('unavailable', status), NOW)).toBe(0);
    }
  });

  it('waits out a short Retry-After, and keeps the error page for a long one', () => {
    expect(navigationRecoveryDelay(new PageTransportError(503, '3'), NOW)).toBe(3000);
    expect(navigationRecoveryDelay(new PageTransportError(503, new Date(NOW + 5000).toUTCString()), NOW)).toBe(5000);
    expect(navigationRecoveryDelay(new PageTransportError(503, String(MAX_RECOVERY_WAIT_MS / 1000 + 1)), NOW)).toBeNull();
    expect(navigationRecoveryDelay(new PageTransportError(503, 'whenever'), NOW)).toBe(0);
  });
});

describe('retryAfterMs', () => {
  it('reads seconds and HTTP dates, never a negative wait', () => {
    expect(retryAfterMs(' 120 ', NOW)).toBe(120_000);
    expect(retryAfterMs(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(0);
    expect(retryAfterMs(undefined, NOW)).toBeNull();
    expect(retryAfterMs('soon', NOW)).toBeNull();
  });
});
