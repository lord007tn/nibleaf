import { readerActivationQuery, readerJwtHandoffBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { activateReaderInvitation, jwtReaderHandoff, logoutReader } from '@/actions/reader-access';
import { env } from '@/env';
import { badRequest } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';

const noCache = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

const app = new Hono<HonoEnv>()
  .get('/activate', validator('query', readerActivationQuery), async (ctx) => {
    const projectId = await activateReaderInvitation(ctx, ctx.req.valid('query').token);
    for (const [name, value] of Object.entries(noCache)) ctx.header(name, value);
    const requestHost = new URL(ctx.req.url).host;
    const appHost = new URL(env.APP_URL).host;
    return ctx.redirect(requestHost && requestHost !== appHost ? '/' : `/sites/${encodeURIComponent(projectId)}`, 303);
  })
  .post('/jwt/:projectId', validator('json', readerJwtHandoffBody), async (ctx) => {
    const body = ctx.req.valid('json');
    const data = await jwtReaderHandoff(ctx, ctx.req.param('projectId'), body.token);
    for (const [name, value] of Object.entries(noCache)) ctx.header(name, value);
    if (body.redirect) {
      if (!body.redirect.startsWith('/') || body.redirect.startsWith('//')) throw badRequest('Redirect must be a same-origin path.');
      return ctx.json({ data: { ...data, redirect: body.redirect } }, 200);
    }
    return ctx.json({ data }, 200);
  })
  .post('/logout/:projectId', async (ctx) => ctx.json({ data: await logoutReader(ctx, ctx.req.param('projectId')) }, 200));

export default app;
