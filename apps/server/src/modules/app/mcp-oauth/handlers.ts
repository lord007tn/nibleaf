import { signedOAuthQuerySubset } from '@nibleaf/auth/mcp-oauth';
import { MCP_OAUTH_PAGES, MCP_OAUTH_REQUEST_PARAM, type McpOAuthStep } from '@nibleaf/shared/mcp';
import { createMcpOAuthGrantBody, mcpOAuthAuthorizationQuery } from '@nibleaf/validators';
import { Hono } from 'hono';
import { createMcpOAuthGrant, getMcpOAuthAuthorization } from '@/actions/mcp-oauth';
import { AppError } from '@/errors';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import mcpOAuthRoutes from './routes';

const sessionOrThrow = (session: HonoEnv['Variables']['session']) => {
  if (!session) throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  return session;
};

const isStep = (value: string): value is McpOAuthStep => Object.hasOwn(MCP_OAUTH_PAGES, value);

const app = new Hono<HonoEnv>()
  // Better Auth sends the browser here with its signed query; forward to the
  // dashboard page with that query wrapped in one opaque parameter (see
  // MCP_OAUTH_HANDOFF_PATH). Only fixed same-origin pages are targets.
  .get('/handoff/:step', ...mcpOAuthRoutes.handoff, (ctx) => {
    const step = ctx.req.param('step');
    if (!isStep(step)) return ctx.notFound();
    const signed = signedOAuthQuerySubset(new URL(ctx.req.url).search);
    const target = signed
      ? `${MCP_OAUTH_PAGES[step]}?${MCP_OAUTH_REQUEST_PARAM}=${Buffer.from(signed, 'utf8').toString('base64url')}`
      : MCP_OAUTH_PAGES[step];
    ctx.header('cache-control', 'no-store');
    ctx.header('referrer-policy', 'no-referrer');
    return ctx.redirect(target, 302);
  })
  .get('/authorization', ...mcpOAuthRoutes.authorization, validator('query', mcpOAuthAuthorizationQuery), async (ctx) => {
    const { oauthQuery } = ctx.req.valid('query');
    return ctx.json({ data: await getMcpOAuthAuthorization(getContextUserOrThrow(), sessionOrThrow(ctx.get('session')), oauthQuery) }, 200);
  })
  .post('/grants', ...mcpOAuthRoutes.createGrant, validator('json', createMcpOAuthGrantBody), async (ctx) => {
    const grant = await createMcpOAuthGrant(getContextUserOrThrow(), sessionOrThrow(ctx.get('session')), ctx.req.valid('json'));
    return ctx.json({ data: grant }, 201);
  });

export default app;
