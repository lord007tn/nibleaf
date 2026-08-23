import type { McpServer } from '@modelcontextprotocol/server';
import { analyticsRangeEnum } from '@nibleaf/validators';
import type { Context } from 'hono';
import { z } from 'zod';
import { getAnalyticsOverview } from '@/actions/analytics';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool } from './result';
import type { McpPrincipal } from './types';

const safeSearchAggregates = z
  .object({
    total: z.number().nullable(),
    zeroResults: z.number().nullable().optional(),
    clickedResults: z.number().nullable().optional(),
    averageLatencyMs: z.number().nullable().optional(),
  })
  .passthrough()
  .transform(({ total, zeroResults, clickedResults, averageLatencyMs }) => ({
    total,
    zeroResults: zeroResults ?? null,
    clickedResults: clickedResults ?? null,
    averageLatencyMs: averageLatencyMs ?? null,
  }));

const getAnalyticsDto = async (organizationId: string, projectId: string, range: '24h' | '7d' | '30d' | '90d', timezone?: string) => {
  const overview = await getAnalyticsOverview(organizationId, projectId, range, timezone);
  return {
    availability: overview.availability,
    source: overview.source,
    range: overview.range,
    timezone: overview.timezone,
    totalViews: overview.totalViews,
    uniqueVisitors: overview.uniqueVisitors,
    timeseries: overview.timeseries,
    topPages: overview.topPages,
    languages: overview.languages,
    devices: overview.devices,
    engagement: overview.engagement,
    searches: safeSearchAggregates.parse(overview.searches),
    ai: overview.ai,
    noAnswerReasons: overview.noAnswerReasons,
  };
};

export const registerInsightSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (!principal.apiKey.scopes.includes('analytics:read')) return;
  server.registerTool(
    'get_analytics_overview',
    {
      title: 'Get analytics overview',
      description: 'Get privacy-safe aggregate analytics for the bound project. Search terms and raw visitor data are excluded.',
      inputSchema: z.object({ range: analyticsRangeEnum, timezone: z.string().trim().min(1).max(64).optional() }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ range, timezone }) =>
      runMcpReadTool(ctx, principal, 'get_analytics_overview', 'analytics:read', () =>
        getAnalyticsDto(principal.project.organizationId, principal.project.id, range, timezone),
      ),
  );
};
