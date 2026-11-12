import type { McpServer } from '@modelcontextprotocol/server';
import { keys as analyticsKeys } from '@nibleaf/clickhouse';
import { isMcpWriteScope, MCP_KEY_PRESETS, MCP_PRESET_SCOPES, MCP_TOOL_SCOPES, type McpScope, type McpToolName } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import { contentWriteTools } from './content-write';
import { investigationTools } from './investigate';
import { dashboardBase } from './links';
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

/**
 * Why a job the person may ask for can't be done through this connection, so
 * the assistant can say so instead of failing silently. `kind`, in the order
 * they are checked, so the first real blocker is the one reported:
 * - `data`: this server doesn't collect what the job needs; no permission helps;
 * - `credential`: the key itself can't write (no live creator);
 * - `permission`: this connection lacks the one scope the job's tools need,
 *   named in `unlockedBy` (exactly that scope, never more);
 * - `dashboard_only`: deliberately not offered over MCP.
 */
type UnavailableJob = {
  domain: string;
  kind: 'data' | 'credential' | 'permission' | 'dashboard_only';
  reason: string;
  unlockedBy?: McpScope[];
};

/** The jobs a person asks an assistant for, each named by the tool that does it,
 *  so its required scope comes from MCP_TOOL_SCOPES rather than a second list. */
const JOBS = [
  { domain: 'page_drafts', tool: 'create_page_draft', what: 'Creating and editing page drafts' },
  { domain: 'publishing', tool: 'publish_changes', what: 'Publishing changes after a confirmed preview' },
  { domain: 'search_terms', tool: 'get_failed_searches', what: 'Reading what visitors searched for (top and failed searches)', searchData: true },
] as const satisfies ReadonlyArray<{ domain: string; tool: McpToolName; what: string; searchData?: true }>;

const unavailableJobs = (principal: McpPrincipal): UnavailableJob[] => {
  const scopes = principal.credential.scopes;
  const searchDataKept = analyticsKeys().ANALYTICS_MODE === 'clickhouse';
  const jobs: UnavailableJob[] = [];
  for (const job of JOBS) {
    const scope = MCP_TOOL_SCOPES[job.tool];
    if ('searchData' in job && !searchDataKept)
      jobs.push({
        domain: job.domain,
        kind: 'data',
        reason: `${job.what} is not possible on this server: its analytics run without ClickHouse, so no individual search terms or failed searches are kept. No permission changes that; counts are still available.`,
      });
    else if (isMcpWriteScope(scope) && !principal.actor)
      jobs.push({
        domain: job.domain,
        kind: 'credential',
        reason: `${job.what} is not possible with this key: it has no active creator, so it can only read. Create a new key from the dashboard.`,
      });
    else if (!scopes.includes(scope))
      jobs.push({
        domain: job.domain,
        kind: 'permission',
        reason: `${job.what} needs the ${scope} permission, and only that one.`,
        unlockedBy: [scope],
      });
  }
  jobs.push(
    {
      domain: 'page_deletion',
      kind: 'dashboard_only',
      reason: 'Deleting pages is intentionally not available over MCP; a person can delete pages in the dashboard.',
    },
    {
      domain: 'settings_mutations',
      kind: 'dashboard_only',
      reason:
        'Project settings, themes, languages, versions, domains, members, API keys, integrations and add-ons can only be changed in the dashboard.',
    },
    { domain: 'deployment_rollback', kind: 'dashboard_only', reason: 'Rolling back a deployment is only available in the dashboard.' },
  );
  return jobs;
};

/** The permission level these scopes match exactly, or `custom`. */
const permissionOf = (scopes: readonly McpScope[]) =>
  MCP_KEY_PRESETS.find(
    (preset) => MCP_PRESET_SCOPES[preset].length === scopes.length && MCP_PRESET_SCOPES[preset].every((scope) => scopes.includes(scope)),
  ) ?? 'custom';

const getCapabilityDto = (principal: McpPrincipal) => ({
  schemaVersion: 1,
  /** The one website this connection works on, and where the person manages it. */
  website: { id: principal.project.id, name: principal.project.name, dashboardUrl: dashboardBase(principal.project.id) },
  /** The permission level, by name, as the dashboard shows it. */
  permission: permissionOf(principal.credential.scopes),
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
  unavailable: unavailableJobs(principal),
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
