import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';

const mcpOAuthRoutes = {
  // Public: Better Auth redirects here before and after sign-in.
  handoff: createRouteConfig({
    guard: [],
    tags: ['mcp-oauth'],
    description: 'Forward an MCP OAuth step from Better Auth to its dashboard page.',
    responses: { 302: { description: 'redirect' }, ...errorResponses },
  }),
  authorization: createRouteConfig({
    guard: [isAuthenticated],
    tags: ['mcp-oauth'],
    description: 'Describe an MCP OAuth authorization request: the client, and the projects and presets the person may grant.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  createGrant: createRouteConfig({
    guard: [isAuthenticated],
    tags: ['mcp-oauth'],
    description: 'Bind an MCP OAuth authorization request to one project and permission preset.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
};

export default mcpOAuthRoutes;
