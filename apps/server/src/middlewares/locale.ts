import { resolveRequestLocale } from '@nibleaf/i18n/locales';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';

/** Resolve the dashboard locale once so actions and email rendering use the
 * same Paraglide language selected by the person making the request. */
export const localeMiddleware = (): MiddlewareHandler<HonoEnv> => async (ctx, next) => {
  ctx.set('locale', resolveRequestLocale(ctx.req.raw.headers));
  await next();
};
