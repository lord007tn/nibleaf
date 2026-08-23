import type { McpServer } from '@modelcontextprotocol/server';
import type { McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const availableTools = [
  ['get_capabilities', 'mcp:connect'],
  ['get_project', 'projects:read'],
  ['list_pages', 'pages:read'],
  ['get_page', 'pages:read'],
  ['list_languages', 'languages:read'],
  ['list_versions', 'versions:read'],
  ['get_analytics_overview', 'analytics:read'],
  ['get_theme_template', 'themes:read'],
  ['preview_theme_import', 'themes:read'],
  ['list_exports', 'exports:read'],
  ['get_export', 'exports:read'],
  ['list_deployments', 'deployments:read'],
  ['get_deployment', 'deployments:read'],
  ['get_pending_changes', 'deployments:read'],
  ['get_git_integration_status', 'integrations:read'],
] as const satisfies ReadonlyArray<readonly [string, McpScope]>;

const availableResources = (projectId: string) =>
  [
    ['nibleaf://capabilities', 'mcp:connect'],
    [`nibleaf://projects/${projectId}`, 'projects:read'],
    [`nibleaf://projects/${projectId}/pages`, 'pages:read'],
    [`nibleaf://projects/${projectId}/pages/{pageId}`, 'pages:read'],
    [`nibleaf://projects/${projectId}/languages`, 'languages:read'],
    [`nibleaf://projects/${projectId}/versions`, 'versions:read'],
    [`nibleaf://projects/${projectId}/theme-template`, 'themes:read'],
    [`nibleaf://projects/${projectId}/deployments/latest`, 'deployments:read'],
  ] as const satisfies ReadonlyArray<readonly [string, McpScope]>;

const getCapabilityDto = (principal: McpPrincipal) => ({
  schemaVersion: 1,
  mode: 'read_only_with_preview' as const,
  project: { id: principal.project.id, name: principal.project.name },
  grantedScopes: principal.apiKey.scopes,
  rateLimit: {
    scope: 'instance' as const,
    requestsPerMinute: env.MCP_RATE_LIMIT_PER_MIN,
    deploymentWideProtection: 'upstream_required' as const,
  },
  tools: availableTools.filter(([, scope]) => principal.apiKey.scopes.includes(scope)).map(([name, scope]) => ({ name, scope })),
  resources: availableResources(principal.project.id)
    .filter(([, scope]) => principal.apiKey.scopes.includes(scope))
    .map(([uri, scope]) => ({ uri, scope })),
  unavailable: [
    { domain: 'search', reason: 'Pending context-authenticated search read actions on the integration baseline.' },
    { domain: 'usage_entitlements', reason: 'Pending provider-neutral usage and entitlement actions on the integration baseline.' },
    { domain: 'addons', reason: 'Pending context-authenticated add-on actions on the integration baseline.' },
    { domain: 'integrations_lifecycle', reason: 'Pending provider-discriminated integration actions on the integration baseline.' },
    { domain: 'mutations', reason: 'Actor, confirmation, idempotency, or revision-safe action dependencies are not available in this release.' },
  ],
  excluded: ['credentials', 'provider_payloads', 'payment_actions', 'database_primitives', 'filesystem_access', 'code_execution'],
});

export const registerCapabilitySurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  server.registerTool(
    'get_capabilities',
    {
      title: 'Get Nibleaf MCP capabilities',
      description: 'List only the tools and resources available to this project-bound API key, plus intentionally unavailable domains.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () => runMcpReadTool(ctx, principal, 'get_capabilities', 'mcp:connect', async () => getCapabilityDto(principal)),
  );
  server.registerResource(
    'capabilities',
    'nibleaf://capabilities',
    { title: 'Nibleaf MCP capabilities', description: 'Truthful capability discovery for the bound project.', mimeType: 'application/json' },
    (uri) => runMcpResource(ctx, principal, 'capabilities', 'mcp:connect', uri, async () => getCapabilityDto(principal)),
  );
};
