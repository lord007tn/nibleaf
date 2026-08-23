import { prisma } from '@nibleaf/database';
import type { Context } from 'hono';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import type { McpPrincipal } from './types';

export const recordMcpAudit = async (
  ctx: Context<HonoEnv>,
  principal: McpPrincipal,
  event: {
    kind: 'tool' | 'resource';
    operation: string;
    capability: string;
    outcome: 'succeeded' | 'failed';
    errorCode?: string;
    durationMs: number;
  },
) => {
  try {
    await prisma.mcpAuditEvent.create({
      data: {
        projectId: principal.project.id,
        apiKeyId: principal.apiKey.id,
        requestId: ctx.get('requestId'),
        kind: event.kind,
        operation: event.operation,
        capability: event.capability,
        outcome: event.outcome,
        errorCode: event.errorCode,
        durationMs: Math.max(0, Math.round(event.durationMs)),
      },
      select: { id: true },
    });
  } catch {
    throw new AppError({ code: 'storage:error', message: 'The MCP audit event could not be persisted.' });
  }
};
