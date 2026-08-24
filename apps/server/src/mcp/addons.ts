import type { McpServer } from '@modelcontextprotocol/server';
import { addonIdSchema, type ListProjectAddonAuditQuery, listProjectAddonAuditQuery } from '@nibleaf/validators/addons';
import type { Context } from 'hono';
import { z } from 'zod';
import { getProjectAddon, listProjectAddonAuditEvents, listProjectAddons } from '@/actions/addons';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const addonInput = z.object({ addonId: addonIdSchema }).strict();

const addonDto = (addon: {
  id: string;
  group: string;
  enabled: boolean;
  config: Record<string, unknown>;
  revision: number;
  updatedAt: string | null;
  status: string;
  availability: Record<string, unknown>;
}) => ({
  id: addon.id,
  group: addon.group,
  enabled: addon.enabled,
  config: addon.config,
  revision: addon.revision,
  updatedAt: addon.updatedAt,
  status: addon.status,
  availability: addon.availability,
});

const listAddonsDto = async (ctx: Context<HonoEnv>, projectId: string) => (await listProjectAddons(ctx, projectId)).map((addon) => addonDto(addon));

const getAddonDto = async (ctx: Context<HonoEnv>, projectId: string, addonId: string) => addonDto(await getProjectAddon(ctx, projectId, addonId));

const listAddonAuditDto = async (ctx: Context<HonoEnv>, projectId: string, query: ListProjectAddonAuditQuery) => {
  const audit = await listProjectAddonAuditEvents(ctx, projectId, query);
  return {
    items: audit.items.map((event) => ({
      id: event.id,
      addonId: event.addonKey,
      action: event.action,
      previousEnabled: event.previousEnabled,
      nextEnabled: event.nextEnabled,
      previousConfig: event.previousConfig,
      nextConfig: event.nextConfig,
      revision: event.revision,
      createdAt: event.createdAt,
    })),
    nextCursor: audit.nextCursor,
  };
};

export const registerAddonSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (!principal.apiKey.scopes.includes('addons:read')) return;
  server.registerTool(
    'list_addons',
    {
      title: 'List add-ons',
      description: 'List the authoritative add-on catalog, state, availability, and safe configuration.',
      annotations: readOnly,
    },
    () => runMcpReadTool(ctx, principal, 'list_addons', 'addons:read', () => listAddonsDto(ctx, principal.project.id)),
  );
  server.registerTool(
    'get_addon',
    { title: 'Get add-on', description: 'Read one project add-on by stable registry ID.', inputSchema: addonInput, annotations: readOnly },
    ({ addonId }) => runMcpReadTool(ctx, principal, 'get_addon', 'addons:read', () => getAddonDto(ctx, principal.project.id, addonId)),
  );
  server.registerTool(
    'list_addon_audit_events',
    {
      title: 'List add-on audit events',
      description: 'Read bounded, project-bound add-on configuration audit events.',
      inputSchema: listProjectAddonAuditQuery,
      annotations: readOnly,
    },
    (query) => runMcpReadTool(ctx, principal, 'list_addon_audit_events', 'addons:read', () => listAddonAuditDto(ctx, principal.project.id, query)),
  );
  server.registerResource(
    'addons',
    `nibleaf://projects/${principal.project.id}/addons`,
    { title: 'Nibleaf project add-ons', mimeType: 'application/json' },
    (uri) => runMcpResource(ctx, principal, 'addons', 'addons:read', uri, () => listAddonsDto(ctx, principal.project.id)),
  );
};
