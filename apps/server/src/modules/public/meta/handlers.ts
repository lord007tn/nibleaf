import { googleOAuthEnabled } from '@nibleaf/auth/providers';
import { Hono } from 'hono';
import { aiDraftAvailable } from '@/actions/ai';
import { env } from '@/env';
import { answerSearchAvailable } from '@/lib/ai-search/runtime';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import metaRoutes from './routes';

/** Public instance metadata. AI flags report instance capability only, never provider keys. OAuth credentials never cross this boundary.
 *  GTM and GA4 identifiers are intentionally public, but remain inert until
 *  the visitor consents. GTM suppresses the direct GA4 fallback when present. */
const app = new Hono<HonoEnv>().get('/', ...metaRoutes.meta, (ctx) =>
  ctx.json(
    {
      data: {
        ai: { draft: aiDraftAvailable(), answers: answerSearchAvailable() },
        marketingAnalytics: {
          consentRequired: true as const,
          // GTM owns loading; its destination ID also enables browser opt-out.
          ga4MeasurementId: envExtras.MARKETING_GA4_ID ?? null,
          gtmContainerId: envExtras.MARKETING_GTM_ID ?? null,
        },
        providers: { google: googleOAuthEnabled(env) },
        signupDisabled: envExtras.DISABLE_SIGNUP,
      },
    },
    200,
  ),
);

export default app;
