import type { McpServer } from '@modelcontextprotocol/server';
import type { McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import type { McpPrincipal } from './types';

/** Tools this module registers, for truthful capability discovery. */
export const contentWriteTools: ReadonlyArray<readonly [string, McpScope]> = [];

/** Support-writer content tools: search-before-create, drafts, edits, moves,
 *  translations, visibility, and preview-then-confirm publishing. */
export const registerContentWriteSurface = (_server: McpServer, _ctx: Context<HonoEnv>, _principal: McpPrincipal) => {};
