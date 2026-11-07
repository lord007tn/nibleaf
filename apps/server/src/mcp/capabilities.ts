import type { McpServer } from '@modelcontextprotocol/server';
import { isMcpWriteScope, type McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import { contentWriteTools } from './content-write';
import { investigationTools } from './investigate';
import { supportPrompts } from './prompts';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const coreTools = [
  ['get_capabilities', 'mcp:connect'],
  ['get_project', 'projects:read'],
  ['list_pages', 'pages:read'],
  ['get_page', 'pages:read'],
  ['list_languages', 'languages:read'],
  ['list_versions', 'versions:read'],
  ['get_analytics_overview', 'analytics:read'],
  ['list_ai_conversations', 'analytics:read'],
  ['get_ai_conversation', 'analytics:read'],
  ['get_ai_usage', 'analytics:read'],
  ['get_ai_feedback_summary', 'analytics:read'],
  ['list_ai_content_gaps', 'analytics:read'],
  ['get_search_configuration', 'search:read'],
  ['get_search_index_diagnostics', 'search:read'],
  ['get_usage_summary', 'usage:read'],
  ['get_entitlements', 'entitlements:read'],
  ['check_entitlement', 'entitlements:read'],
  ['list_addons', 'addons:read'],
  ['get_addon', 'addons:read'],
  ['list_addon_audit_events', 'addons:read'],
  ['get_theme_template', 'themes:read'],
  ['get_theme_catalog', 'themes:read'],
  ['preview_theme_import', 'themes:read'],
  ['list_exports', 'exports:read'],
  ['get_export', 'exports:read'],
  ['list_deployments', 'deployments:read'],
  ['get_deployment', 'deployments:read'],
  ['get_pending_changes', 'deployments:read'],
  ['get_git_integration_status', 'integrations:read'],
  ['list_integrations', 'integrations:read'],
  ['get_integration', 'integrations:read'],
] as const satisfies ReadonlyArray<readonly [string, McpScope]>;

const availableTools: ReadonlyArray<readonly [string, McpScope]> = [...coreTools, ...contentWriteTools, ...investigationTools];

const availableResources = (projectId: string) =>
  [
    ['nibleaf://capabilities', 'mcp:connect'],
    [`nibleaf://projects/${projectId}`, 'projects:read'],
    [`nibleaf://projects/${projectId}/pages`, 'pages:read'],
    [`nibleaf://projects/${projectId}/pages/{pageId}`, 'pages:read'],
    [`nibleaf://projects/${projectId}/pages/{pageId}/markdown`, 'pages:read'],
    [`nibleaf://projects/${projectId}/languages`, 'languages:read'],
    [`nibleaf://projects/${projectId}/versions`, 'versions:read'],
    [`nibleaf://projects/${projectId}/search/configuration`, 'search:read'],
    [`nibleaf://projects/${projectId}/usage`, 'usage:read'],
    [`nibleaf://projects/${projectId}/entitlements`, 'entitlements:read'],
    [`nibleaf://projects/${projectId}/addons`, 'addons:read'],
    [`nibleaf://projects/${projectId}/theme-catalog`, 'themes:read'],
    [`nibleaf://projects/${projectId}/theme-template`, 'themes:read'],
    [`nibleaf://projects/${projectId}/integrations`, 'integrations:read'],
    [`nibleaf://projects/${projectId}/deployments/latest`, 'deployments:read'],
  ] as const satisfies ReadonlyArray<readonly [string, McpScope]>;

const getCapabilityDto = (principal: McpPrincipal) => ({
  schemaVersion: 1,
  /** `read_only_with_preview`: reads plus non-writing previews. `draft_writes_with_confirmed_publish`:
   *  write tools change only the working copy; going live needs preview_publish + a confirmed publish_changes. */
  mode: principal.credential.scopes.some(isMcpWriteScope) ? ('draft_writes_with_confirmed_publish' as const) : ('read_only_with_preview' as const),
  project: { id: principal.project.id, name: principal.project.name },
  grantedScopes: principal.credential.scopes,
  /** The key acts as its creator with this current project role; null = read-only key. */
  actor: principal.actor ? { role: principal.actor.role } : null,
  rateLimit: {
    scope: 'instance' as const,
    requestsPerMinute: env.MCP_RATE_LIMIT_PER_MIN,
    writesPerMinute: env.MCP_WRITE_RATE_LIMIT_PER_MIN,
    publishesPerHour: env.MCP_PUBLISH_RATE_LIMIT_PER_HOUR,
    deploymentWideProtection: 'upstream_required' as const,
  },
  tools: availableTools.filter(([, scope]) => principal.credential.scopes.includes(scope)).map(([name, scope]) => ({ name, scope })),
  resources: availableResources(principal.project.id)
    .filter(([, scope]) => principal.credential.scopes.includes(scope))
    .map(([uri, scope]) => ({ uri, scope })),
  prompts: supportPrompts
    .filter(([, scopes]) => scopes.every((scope) => principal.credential.scopes.includes(scope)))
    .map(([name, scopes]) => ({ name, scopes })),
  unavailable: [
    ...(principal.credential.scopes.some(isMcpWriteScope)
      ? []
      : [
          {
            domain: 'content_writes',
            reason: principal.actor
              ? 'This key does not grant pages:write or deployments:publish.'
              : 'This key has no active creator, so it can only read. Create a new key from the dashboard to write.',
          },
        ]),
    { domain: 'page_deletion', reason: 'Deleting pages is intentionally not available over MCP; a person can delete pages in the dashboard.' },
    {
      domain: 'settings_mutations',
      reason:
        'Project settings, themes, languages, versions, domains, members, API keys, integrations and add-ons can only be changed in the dashboard.',
    },
    { domain: 'deployment_rollback', reason: 'Rolling back a deployment is only available in the dashboard.' },
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
