import { googleOAuthEnabled } from '@nibleaf/auth/providers';
import { Hono } from 'hono';
import { env } from '@/env';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import metaRoutes from './routes';

/** Public instance metadata. OAuth credentials never cross this boundary.
 *  GTM and GA4 identifiers are intentionally public, but remain inert until
 *  the visitor consents. GTM suppresses the direct GA4 fallback when present. */
const app = new Hono<HonoEnv>().get('/', ...metaRoutes.meta, (ctx) =>
  ctx.json(
    {
      data: {
        marketingAnalytics: {
          consentRequired: true as const,
          ga4MeasurementId: envExtras.MARKETING_GTM_ID ? null : (envExtras.MARKETING_GA4_ID ?? null),
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
