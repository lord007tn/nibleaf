import type { McpServer } from '@modelcontextprotocol/server';
import type { McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import { getProjectSearchIndexDiagnostics } from '@/actions/search';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool } from './result';
import { getSupportAnalytics } from './support-analytics';
import { resolveSupportRange, supportRangeSchema } from './support-range';
import type { McpPrincipal } from './types';

export const investigationTools = [
  ['get_top_pages', 'analytics:read'],
  ['get_top_searches', 'analytics:search_terms'],
  ['get_failed_searches', 'analytics:search_terms'],
  ['get_page_feedback', 'analytics:read'],
  ['get_referrers', 'analytics:read'],
  ['get_search_health', 'search:read'],
] as const satisfies ReadonlyArray<readonly [string, McpScope]>;

export const registerInvestigationSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  for (const [name, scope] of investigationTools) {
    if (!principal.apiKey.scopes.includes(scope)) continue;
    server.registerTool(
      name,
      {
        description: `Read ${name.slice(4).replaceAll('_', ' ')} for the bound project. Results are bounded to 50 rows; unavailable metrics are explicit.`,
        inputSchema: supportRangeSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      (input) =>
        runMcpReadTool(ctx, principal, name, scope, async () => {
          if (name !== 'get_search_health') return getSupportAnalytics(principal, name, input);
          const diagnostics = await getProjectSearchIndexDiagnostics(ctx, principal.project.id, { limit: 1 });
          const run = diagnostics.latestRun;
          return {
            range: resolveSupportRange(input),
            rangeApplies: false,
            reason: 'Index health is a current snapshot, independent of the analytics range or language.',
            availability: diagnostics.availability,
            health: diagnostics.health,
            latestRun: run,
            indexedPages: diagnostics.corpus.pages,
            expectedPages: null,
            expectedPagesReason: 'The existing diagnostics action does not expose expected page counts.',
            staleCount: diagnostics.issues.staleCount,
            failedCount: diagnostics.issues.failedCount,
            latestDeploymentIndexed: diagnostics.index.revisionId ? run?.status === 'READY' && diagnostics.health === 'ready' : null,
            deploymentVersion: diagnostics.index.deploymentVersion,
          };
        }),
    );
  }
};
