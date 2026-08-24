import type { McpServer } from '@modelcontextprotocol/server';
import { searchConfigurationResultSchema, searchIndexDiagnosticsQuery } from '@nibleaf/validators';
import type { Context } from 'hono';
import { getProjectSearchConfiguration, getProjectSearchIndexDiagnostics } from '@/actions/search';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const getSearchConfigurationDto = async (ctx: Context<HonoEnv>, projectId: string) =>
  searchConfigurationResultSchema.parse(await getProjectSearchConfiguration(ctx, projectId));

const getSearchIndexDiagnosticsDto = async (ctx: Context<HonoEnv>, projectId: string, query: { cursor?: string; limit: number }) => {
  const diagnostics = await getProjectSearchIndexDiagnostics(ctx, projectId, query);
  return {
    availability: diagnostics.availability,
    health: diagnostics.health,
    runtime: diagnostics.runtime,
    index: {
      logicalId: diagnostics.index.logicalId,
      schemaVersion: diagnostics.index.schemaVersion,
      revisionId: diagnostics.index.revisionId,
      deploymentVersion: diagnostics.index.deploymentVersion,
      embeddingModel: diagnostics.index.embeddingModel,
      vectorSize: diagnostics.index.vectorSize,
    },
    corpus: diagnostics.corpus,
    latestRun: diagnostics.latestRun,
    samples: diagnostics.samples,
    issues: diagnostics.issues,
  };
};

export const registerSearchSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (!principal.apiKey.scopes.includes('search:read')) return;
  server.registerTool(
    'get_search_configuration',
    {
      title: 'Get search configuration',
      description: 'Read the resolved provider-neutral search controls for the bound project.',
      annotations: readOnly,
    },
    () => runMcpReadTool(ctx, principal, 'get_search_configuration', 'search:read', () => getSearchConfigurationDto(ctx, principal.project.id)),
  );
  server.registerTool(
    'get_search_index_diagnostics',
    {
      title: 'Get search index diagnostics',
      description:
        'Read bounded logical index health, counts, facets, run status, and content-free issue metadata. Physical collections, content, vectors, hashes, and provider payloads are excluded.',
      inputSchema: searchIndexDiagnosticsQuery,
      annotations: readOnly,
    },
    (query) =>
      runMcpReadTool(ctx, principal, 'get_search_index_diagnostics', 'search:read', () =>
        getSearchIndexDiagnosticsDto(ctx, principal.project.id, query),
      ),
  );
  server.registerResource(
    'search-configuration',
    `nibleaf://projects/${principal.project.id}/search/configuration`,
    { title: 'Nibleaf search configuration', mimeType: 'application/json' },
    (uri) => runMcpResource(ctx, principal, 'search-configuration', 'search:read', uri, () => getSearchConfigurationDto(ctx, principal.project.id)),
  );
};
