import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  ai: { draft: false, answers: false },
  extras: {
    DISABLE_SIGNUP: false,
    MARKETING_GA4_ID: undefined as string | undefined,
    MARKETING_GTM_ID: undefined as string | undefined,
  },
}));

vi.mock('@nibleaf/auth/providers', () => ({ googleOAuthEnabled: () => true }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/actions/ai', () => ({ aiDraftAvailable: () => mocks.ai.draft }));
vi.mock('@/lib/ai-search/runtime', () => ({ answerSearchAvailable: () => mocks.ai.answers }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));

import handlers from './handlers';

const app = new Hono<HonoEnv>().route('/meta', handlers);

describe('public instance metadata', () => {
  beforeEach(() => {
    mocks.ai.draft = false;
    mocks.ai.answers = false;
    mocks.extras.DISABLE_SIGNUP = false;
    mocks.extras.MARKETING_GA4_ID = undefined;
    mocks.extras.MARKETING_GTM_ID = undefined;
  });

  it('keeps marketing analytics dormant without a configured measurement ID', async () => {
    const response = await app.request('/meta');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ai: { draft: false, answers: false },
        marketingAnalytics: { consentRequired: true, ga4MeasurementId: null, gtmContainerId: null },
        providers: { google: true },
        signupDisabled: false,
      },
    });
  });

  it('exposes only the public GA4 measurement ID, never Google credentials', async () => {
    mocks.extras.MARKETING_GA4_ID = 'G-ABC123';
    const body = (await (await app.request('/meta')).json()) as {
      data: { marketingAnalytics: { consentRequired: boolean; ga4MeasurementId: string | null; gtmContainerId: string | null } };
    };

    expect(body.data.marketingAnalytics).toEqual({ consentRequired: true, ga4MeasurementId: 'G-ABC123', gtmContainerId: null });
    expect(JSON.stringify(body)).not.toContain('clientSecret');
    expect(JSON.stringify(body)).not.toContain('clientId');
  });

  it('exposes the GTM destination for opt-out while the client retains GTM loader ownership', async () => {
    mocks.extras.MARKETING_GA4_ID = 'G-ABC123';
    mocks.extras.MARKETING_GTM_ID = 'GTM-ABC123';
    const body = (await (await app.request('/meta')).json()) as {
      data: { marketingAnalytics: { ga4MeasurementId: string | null; gtmContainerId: string | null } };
    };

    expect(body.data.marketingAnalytics).toEqual({ consentRequired: true, ga4MeasurementId: 'G-ABC123', gtmContainerId: 'GTM-ABC123' });
  });

  it('reports instance AI capabilities', async () => {
    mocks.ai.draft = true;
    mocks.ai.answers = true;
    const body = (await (await app.request('/meta')).json()) as { data: { ai: { draft: boolean; answers: boolean } } };

    expect(body.data.ai).toEqual({ draft: true, answers: true });
  });
});
