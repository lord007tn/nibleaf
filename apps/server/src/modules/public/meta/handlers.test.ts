import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  extras: { DISABLE_SIGNUP: false, MARKETING_GA4_ID: undefined as string | undefined },
}));

vi.mock('@nibleaf/auth/providers', () => ({ googleOAuthEnabled: () => true }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));

import handlers from './handlers';

const app = new Hono<HonoEnv>().route('/meta', handlers);

describe('public instance metadata', () => {
  beforeEach(() => {
    mocks.extras.DISABLE_SIGNUP = false;
    mocks.extras.MARKETING_GA4_ID = undefined;
  });

  it('keeps marketing analytics dormant without a configured measurement ID', async () => {
    const response = await app.request('/meta');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        marketingAnalytics: { consentRequired: true, ga4MeasurementId: null },
        providers: { google: true },
        signupDisabled: false,
      },
    });
  });

  it('exposes only the public GA4 measurement ID, never Google credentials', async () => {
    mocks.extras.MARKETING_GA4_ID = 'G-ABC123';
    const body = (await (await app.request('/meta')).json()) as {
      data: { marketingAnalytics: { consentRequired: boolean; ga4MeasurementId: string | null } };
    };

    expect(body.data.marketingAnalytics).toEqual({ consentRequired: true, ga4MeasurementId: 'G-ABC123' });
    expect(JSON.stringify(body)).not.toContain('clientSecret');
    expect(JSON.stringify(body)).not.toContain('clientId');
  });
});
