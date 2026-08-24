import type { McpServer } from '@modelcontextprotocol/server';
import { capabilityKeySchema } from '@nibleaf/usage';
import type { Context } from 'hono';
import { z } from 'zod';
import { checkProjectEntitlement, getProjectEntitlements, getProjectUsageSummary } from '@/actions/usage';
import type { HonoEnv } from '@/lib/hono/context';
import { runMcpReadTool, runMcpResource } from './result';
import type { McpPrincipal } from './types';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const periodInput = z
  .object({ periodStart: z.iso.datetime({ offset: true }).optional(), periodEndExclusive: z.iso.datetime({ offset: true }).optional() })
  .strict();
const entitlementInput = z.object({ capabilityKey: capabilityKeySchema }).strict();

const usageSummaryDto = async (ctx: Context<HonoEnv>, projectId: string, period?: { periodStart?: string; periodEndExclusive?: string }) => {
  const summary = await getProjectUsageSummary(ctx, projectId, period);
  return {
    schemaVersion: summary.schemaVersion,
    projectId: summary.projectId,
    period: summary.period,
    availability: summary.availability,
    plan: summary.plan,
    meters: summary.meters.map((meter) => ({
      key: meter.key,
      meterKey: meter.meterKey,
      unit: meter.unit,
      quantity: meter.quantity,
      limit: meter.limit,
      availability: meter.availability,
      behavior: meter.behavior,
      enforcement: meter.enforcement,
      periodStart: meter.periodStart,
      periodEndExclusive: meter.periodEndExclusive,
      state: meter.state,
      ratio: meter.ratio,
      allowed: meter.allowed,
    })),
    generatedAt: summary.generatedAt,
  };
};

const entitlementsDto = async (ctx: Context<HonoEnv>, projectId: string) => {
  const summary = await getProjectEntitlements(ctx, projectId);
  return {
    schemaVersion: summary.schemaVersion,
    projectId: summary.projectId,
    planKey: summary.planKey,
    availability: summary.availability,
    entitlements: summary.entitlements.map((entitlement) => ({
      capabilityKey: entitlement.capabilityKey,
      enabled: entitlement.enabled,
      availability: entitlement.availability,
      limit: entitlement.limit,
      meterKey: entitlement.meterKey,
      behavior: entitlement.behavior,
      enforcement: entitlement.enforcement,
    })),
  };
};

export const registerUsageSurface = (server: McpServer, ctx: Context<HonoEnv>, principal: McpPrincipal) => {
  if (principal.apiKey.scopes.includes('usage:read')) {
    server.registerTool(
      'get_usage_summary',
      {
        title: 'Get usage summary',
        description:
          'Read aggregate project usage with exact decimal strings and explicit complete, partial, or unavailable states. Limits are advisory.',
        inputSchema: periodInput,
        annotations: readOnly,
      },
      (period) => runMcpReadTool(ctx, principal, 'get_usage_summary', 'usage:read', () => usageSummaryDto(ctx, principal.project.id, period)),
    );
    server.registerResource(
      'usage',
      `nibleaf://projects/${principal.project.id}/usage`,
      { title: 'Nibleaf project usage', description: 'Current UTC-month aggregate usage summary.', mimeType: 'application/json' },
      (uri) => runMcpResource(ctx, principal, 'usage', 'usage:read', uri, () => usageSummaryDto(ctx, principal.project.id)),
    );
  }

  if (principal.apiKey.scopes.includes('entitlements:read')) {
    server.registerTool(
      'get_entitlements',
      { title: 'Get entitlements', description: 'Read advisory project capability decisions and exact limits.', annotations: readOnly },
      () => runMcpReadTool(ctx, principal, 'get_entitlements', 'entitlements:read', () => entitlementsDto(ctx, principal.project.id)),
    );
    server.registerTool(
      'check_entitlement',
      {
        title: 'Check entitlement',
        description: 'Read one enabled content-free entitlement or return the owning stable entitlement error.',
        inputSchema: entitlementInput,
        annotations: readOnly,
      },
      ({ capabilityKey }) =>
        runMcpReadTool(ctx, principal, 'check_entitlement', 'entitlements:read', () =>
          checkProjectEntitlement(ctx, principal.project.id, capabilityKey),
        ),
    );
    server.registerResource(
      'entitlements',
      `nibleaf://projects/${principal.project.id}/entitlements`,
      { title: 'Nibleaf project entitlements', mimeType: 'application/json' },
      (uri) => runMcpResource(ctx, principal, 'entitlements', 'entitlements:read', uri, () => entitlementsDto(ctx, principal.project.id)),
    );
  }
};
