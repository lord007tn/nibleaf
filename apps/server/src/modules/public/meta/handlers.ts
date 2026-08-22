import { googleOAuthEnabled } from '@nibleaf/auth/providers';
import { Hono } from 'hono';
import { env } from '@/env';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import metaRoutes from './routes';

/** Public instance metadata. OAuth credentials never cross this boundary.
 *  A GA4 measurement ID is intentionally public by design, but remains inert
 *  in the browser until the visitor gives explicit consent. */
const app = new Hono<HonoEnv>().get('/', ...metaRoutes.meta, (ctx) =>
  ctx.json(
    {
      data: {
        marketingAnalytics: {
          consentRequired: true as const,
          ga4MeasurementId: envExtras.MARKETING_GA4_ID ?? null,
        },
        providers: { google: googleOAuthEnabled(env) },
        signupDisabled: envExtras.DISABLE_SIGNUP,
      },
    },
    200,
  ),
);

export default app;
