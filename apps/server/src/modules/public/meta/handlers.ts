import { Hono } from 'hono';
import { env } from '@/env';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import metaRoutes from './routes';

/** Instance metadata for the login/signup UI: which social providers are
 *  configured and whether self-serve sign-up is disabled. Booleans only —
 *  never the underlying secrets or client ids. */
const app = new Hono<HonoEnv>().get('/', ...metaRoutes.meta, (ctx) =>
  ctx.json(
    {
      data: {
        providers: { google: Boolean(env.GOOGLE_CLIENT_ID) },
        signupDisabled: envExtras.DISABLE_SIGNUP,
      },
    },
    200,
  ),
);

export default app;
