import {
  readerAccessRequestBody,
  readerActivationQuery,
  readerInvitationAcceptBody,
  readerJwtHandoffBody,
  siteSignInStartBody,
  siteSignInVerifyBody,
} from '@nibleaf/validators';
import { Hono } from 'hono';
import { activateReaderInvitation, jwtReaderHandoff, logoutReader } from '@/actions/reader-access';
import { requestReaderAccess } from '@/actions/reader-access-requests';
import { readerInvitationLanding, startSiteSignIn, verifySiteSignIn } from '@/actions/site-sign-in';
import { badRequest } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';

const noCache = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

const app = new Hono<HonoEnv>()
  .use('*', async (ctx, next) => {
    await next();
    for (const [name, value] of Object.entries(noCache)) ctx.header(name, value);
  })
  // The emailed invitation link. Opening it no longer uses the invitation up:
  // it opens the site, where the reader accepts it with a click (see /accept).
  .get('/activate', validator('query', readerActivationQuery), async (ctx) =>
    ctx.redirect(await readerInvitationLanding(ctx.req.valid('query').token), 303),
  )
  .post('/accept', validator('json', readerInvitationAcceptBody), async (ctx) => {
    await activateReaderInvitation(ctx, ctx.req.valid('json').token);
    return ctx.json({ data: { ok: true } }, 200);
  })
  .post('/sign-in/:projectId/start', validator('json', siteSignInStartBody), async (ctx) =>
    ctx.json({ data: await startSiteSignIn(ctx.req.param('projectId'), ctx.req.valid('json')) }, 200),
  )
  .post('/sign-in/:projectId/verify', validator('json', siteSignInVerifyBody), async (ctx) =>
    ctx.json({ data: await verifySiteSignIn(ctx, ctx.req.param('projectId'), ctx.req.valid('json')) }, 200),
  )
  // Ask the site's Admins for access. Always the same answer.
  .post('/request/:projectId', validator('json', readerAccessRequestBody), (ctx) =>
    ctx.json({ data: requestReaderAccess(ctx.req.param('projectId'), ctx.req.valid('json')) }, 200),
  )
  .post('/jwt/:projectId', validator('json', readerJwtHandoffBody), async (ctx) => {
    const body = ctx.req.valid('json');
    const data = await jwtReaderHandoff(ctx, ctx.req.param('projectId'), body.token);
    if (body.redirect) {
      if (!body.redirect.startsWith('/') || body.redirect.startsWith('//')) throw badRequest('Redirect must be a same-origin path.');
      return ctx.json({ data: { ...data, redirect: body.redirect } }, 200);
    }
    return ctx.json({ data }, 200);
  })
  .post('/logout/:projectId', async (ctx) => ctx.json({ data: await logoutReader(ctx, ctx.req.param('projectId')) }, 200));

export default app;
