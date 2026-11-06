import type { McpServer } from '@modelcontextprotocol/server';
import type { McpScope } from '@nibleaf/shared/mcp';
import type { McpPrincipal } from './types';

/** Prompts this module registers, with the scopes each needs to be useful. */
export const supportPrompts: ReadonlyArray<readonly [string, ReadonlyArray<McpScope>]> = [];

/** Support workflow prompts (content gaps from failed searches, weekly docs
 *  health report, ...). Prompts only describe steps; they never auto-publish. */
export const registerSupportPrompts = (_server: McpServer, _principal: McpPrincipal) => {};
