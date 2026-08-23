import { McpServer } from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import { registerCapabilitySurface } from './capabilities';
import { registerContentSurface } from './content';
import { registerInsightSurface } from './insights';
import { registerIntegrationSurface } from './integrations';
import { registerOperationSurface } from './operations';
import { registerThemeSurface } from './themes';
import type { McpPrincipal } from './types';

export const createNibleafMcpServer = (ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  const server = new McpServer(
    { name: 'nibleaf', version: '0.1.0' },
    {
      instructions:
        'This server is bound to one Nibleaf project. Discover capabilities before use. It exposes read-only actions plus non-writing theme preview; unavailable domains and mutations are intentionally omitted.',
    },
  );
  registerCapabilitySurface(server, ctx, principal);
  registerContentSurface(server, ctx, principal);
  registerInsightSurface(server, ctx, principal);
  registerThemeSurface(server, ctx, principal);
  registerOperationSurface(server, ctx, principal);
  registerIntegrationSurface(server, ctx, principal);
  return server;
};
