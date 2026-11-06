import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import type { Context } from 'hono';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { mcpCredentialColumns } from './credential';
import type { McpAuditTarget, McpPrincipal } from './types';

const log = createLogger({ module: 'mcp-audit' });

type McpAuditEvent = {
  kind: 'tool' | 'resource';
  operation: string;
  capability: string;
  /** `started` marks a write that was about to run; it is settled afterwards. */
  outcome: 'started' | 'succeeded' | 'replayed' | 'failed';
  errorCode?: string;
  /** Write tools: the entity the attempt touched (or would have touched). */
  target?: McpAuditTarget | null;
  /** Write tools: the caller's idempotency id, when it supplied a valid one. */
  clientRequestId?: string | null;
  durationMs: number;
};

const auditUnavailable = (ctx: Context<HonoEnv>, error: unknown) => {
  log.error({ errorName: error instanceof Error ? error.name : 'UnknownError', requestId: ctx.get('requestId') }, 'MCP audit persistence failed');
  return new AppError({ code: 'storage:error', message: 'The MCP audit event could not be persisted.' });
};

export const recordMcpAudit = async (ctx: Context<HonoEnv>, principal: McpPrincipal, event: McpAuditEvent) => {
  try {
    return await prisma.mcpAuditEvent.create({
      data: {
        projectId: principal.project.id,
        ...mcpCredentialColumns(principal.credential),
        actorUserId: principal.actor?.userId ?? null,
        requestId: ctx.get('requestId'),
        kind: event.kind,
        operation: event.operation,
        capability: event.capability,
        outcome: event.outcome,
        errorCode: event.errorCode,
        targetType: event.target?.type ?? null,
        targetId: event.target?.id ?? null,
        clientRequestId: event.clientRequestId ?? null,
        durationMs: Math.max(0, Math.round(event.durationMs)),
      },
      select: { id: true },
    });
  } catch (error) {
    throw auditUnavailable(ctx, error);
  }
};

/**
 * A write records its audit row before it runs (outcome `started`) and settles
 * that same row afterwards. If the row can't be written the write never runs,
 * and if settling fails the committed change still has a durable entry showing
 * it was attempted. Returns the row id for `settleMcpWriteAudit`.
 */
export const beginMcpWriteAudit = async (ctx: Context<HonoEnv>, principal: McpPrincipal, event: Omit<McpAuditEvent, 'outcome' | 'errorCode'>) =>
  (await recordMcpAudit(ctx, principal, { ...event, outcome: 'started' })).id;

export const settleMcpWriteAudit = async (
  ctx: Context<HonoEnv>,
  id: string,
  event: { outcome: 'succeeded' | 'failed'; errorCode?: string; target?: McpAuditTarget | null; durationMs: number },
) => {
  try {
    await prisma.mcpAuditEvent.update({
      where: { id },
      data: {
        outcome: event.outcome,
        errorCode: event.errorCode ?? null,
        ...(event.target ? { targetType: event.target.type, targetId: event.target.id } : {}),
        durationMs: Math.max(0, Math.round(event.durationMs)),
      },
      select: { id: true },
    });
  } catch (error) {
    throw auditUnavailable(ctx, error);
  }
};
