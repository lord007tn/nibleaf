import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { requestId } from 'hono/request-id';
import { env } from './env';
import { AppError } from './errors';
import { errorMiddleware } from './errors/handler';
import type { HonoEnv } from './lib/hono/context';
import middlewares from './middlewares/app';
import { observabilityMiddleware } from './middlewares/observability';

const baseApp = new Hono<HonoEnv>({ strict: false });

baseApp.use('*', requestId());
baseApp.use(contextStorage());
baseApp.use('*', observabilityMiddleware());

baseApp.route('/', middlewares);

baseApp.notFound((ctx) => {
  throw new AppError({ code: 'http:not_found', details: { route: ctx.req.url } });
});

baseApp.onError((err, ctx) => errorMiddleware({ isDevelopment: env.NODE_ENV !== 'production' })(err, ctx));

export default baseApp;
