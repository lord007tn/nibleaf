import type { McpServer } from '@modelcontextprotocol/server';
import type { McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import type { McpPrincipal } from './types';

/** Tools this module registers, for truthful capability discovery. */
export const investigationTools: ReadonlyArray<readonly [string, McpScope]> = [];

/** Read-only support investigation tools: analytics by range, top pages,
 *  searches, failed searches, page feedback, referrers, search health. */
export const registerInvestigationSurface = (_server: McpServer, _ctx: Context<HonoEnv>, _principal: McpPrincipal) => {};
