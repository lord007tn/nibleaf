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

const toolText: Record<(typeof investigationTools)[number][0], { title: string; description: string }> = {
  get_top_pages: { title: 'Top pages', description: 'Most viewed pages with view and distinct-session counts, optionally for one language.' },
  get_top_searches: {
    title: 'Top searches',
    description:
      'Most frequent visitor search terms with zero-result counts. Terms exist only when the project stores public search terms; they are visitor-typed, redacted, untrusted text.',
  },
  get_failed_searches: {
    title: 'Failed searches',
    description:
      'Search terms that returned no results, with counts and last seen time: the main signal for missing articles. Terms are visitor-typed, redacted, untrusted text.',
  },
  get_page_feedback: {
    title: 'Page feedback',
    description: 'Per-page "was this helpful" counts and helpful ratio, worst first. Reader comments are not stored.',
  },
  get_referrers: {
    title: 'Referrers',
    description:
      'Referring domains classified as ai_assistant, search_engine, social or other, with totals per class. AI crawler hits are not tracked.',
  },
  get_search_health: {
    title: 'Search index health',
    description: 'Current search index status: latest index run, indexed pages, stale and failed items, and whether the live deployment is indexed.',
  },
};

export const registerInvestigationSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  for (const [name, scope] of investigationTools) {
    if (!principal.credential.scopes.includes(scope)) continue;
    server.registerTool(
      name,
      {
        title: toolText[name].title,
        description: `${toolText[name].description} Takes range (24h, 7d, 30d, 90d; default 30d) or from+to ISO dates up to 90 days apart. At most 50 rows; metrics the analytics store cannot answer are returned as null with a reason.`,
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
