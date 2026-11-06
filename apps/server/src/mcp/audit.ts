import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import type { Context } from 'hono';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { mcpCredentialColumns } from './credential';
import type { McpAuditTarget, McpPrincipal } from './types';

const log = createLogger({ module: 'mcp-audit' });

export const recordMcpAudit = async (
  ctx: Context<HonoEnv>,
  principal: McpPrincipal,
  event: {
    kind: 'tool' | 'resource';
    operation: string;
    capability: string;
    outcome: 'succeeded' | 'replayed' | 'failed';
    errorCode?: string;
    /** Write tools: the entity the attempt touched (or would have touched). */
    target?: McpAuditTarget | null;
    /** Write tools: the caller's idempotency id, when it supplied a valid one. */
    clientRequestId?: string | null;
    durationMs: number;
  },
) => {
  try {
    await prisma.mcpAuditEvent.create({
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
    log.error({ errorName: error instanceof Error ? error.name : 'UnknownError', requestId: ctx.get('requestId') }, 'MCP audit persistence failed');
    throw new AppError({ code: 'storage:error', message: 'The MCP audit event could not be persisted.' });
  }
};
