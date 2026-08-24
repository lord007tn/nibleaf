import { type CallToolResult, ProtocolError, ProtocolErrorCode, type ReadResourceResult, ResourceNotFoundError } from '@modelcontextprotocol/server';
import { createLogger } from '@nibleaf/logger';
import type { McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { recordMcpAudit } from './audit';
import type { McpErrorEnvelope, McpPrincipal, McpSuccessEnvelope } from './types';

const log = createLogger({ module: 'mcp-tools' });

const retryableCodes = new Set(['http:rate_limited', 'provider:unavailable', 'storage:error', 'search:unavailable', 'mcp:disabled']);

const toolContent = (value: McpSuccessEnvelope | McpErrorEnvelope) => [{ type: 'text' as const, text: JSON.stringify(value) }];

const toolErrorResult = (ctx: Context<HonoEnv>, appError: AppError): CallToolResult => {
  const envelope: McpErrorEnvelope = {
    ok: false,
    error: {
      code: appError.code,
      message: appError.status >= 500 ? 'The MCP operation is temporarily unavailable.' : appError.message,
      retryable: retryableCodes.has(appError.code),
      requestId: ctx.get('requestId'),
    },
  };
  return { content: toolContent(envelope), structuredContent: envelope, isError: true };
};

export const runMcpReadTool = async (
  ctx: Context<HonoEnv>,
  principal: McpPrincipal,
  operation: string,
  capability: McpScope,
  action: () => Promise<unknown>,
): Promise<CallToolResult> => {
  const startedAt = performance.now();
  try {
    if (!principal.apiKey.scopes.includes(capability)) {
      throw new AppError({ code: 'mcp:scope_required', message: `This tool requires the ${capability} scope.` });
    }
    const envelope: McpSuccessEnvelope = {
      ok: true,
      data: await action(),
      meta: { requestId: ctx.get('requestId'), projectId: principal.project.id, capability },
    };
    await recordMcpAudit(ctx, principal, { kind: 'tool', operation, capability, outcome: 'succeeded', durationMs: performance.now() - startedAt });
    return { content: toolContent(envelope), structuredContent: envelope };
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError({ code: 'http:internal', message: 'The MCP operation failed.' });
    if (!(error instanceof AppError)) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError', operation, requestId: ctx.get('requestId') },
        'unhandled MCP tool error',
      );
    }
    try {
      await recordMcpAudit(ctx, principal, {
        kind: 'tool',
        operation,
        capability,
        outcome: 'failed',
        errorCode: appError.code,
        durationMs: performance.now() - startedAt,
      });
      return toolErrorResult(ctx, appError);
    } catch (auditError) {
      return toolErrorResult(
        ctx,
        auditError instanceof AppError ? auditError : new AppError({ code: 'storage:error', message: 'Audit unavailable.' }),
      );
    }
  }
};

export const runMcpResource = async (
  ctx: Context<HonoEnv>,
  principal: McpPrincipal,
  operation: string,
  capability: McpScope,
  uri: URL,
  action: () => Promise<unknown>,
): Promise<ReadResourceResult> => {
  const startedAt = performance.now();
  try {
    if (!principal.apiKey.scopes.includes(capability)) {
      throw new AppError({ code: 'mcp:scope_required', message: `This resource requires the ${capability} scope.` });
    }
    const data = await action();
    await recordMcpAudit(ctx, principal, {
      kind: 'resource',
      operation,
      capability,
      outcome: 'succeeded',
      durationMs: performance.now() - startedAt,
    });
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ ok: true, data }) }] };
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError({ code: 'http:internal', message: 'The MCP resource is unavailable.' });
    if (!(error instanceof AppError)) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError', operation, requestId: ctx.get('requestId') },
        'unhandled MCP resource error',
      );
    }
    try {
      await recordMcpAudit(ctx, principal, {
        kind: 'resource',
        operation,
        capability,
        outcome: 'failed',
        errorCode: appError.code,
        durationMs: performance.now() - startedAt,
      });
    } catch (auditError) {
      const auditAppError = auditError instanceof AppError ? auditError : new AppError({ code: 'storage:error', message: 'Audit unavailable.' });
      throw new ProtocolError(ProtocolErrorCode.InternalError, 'The MCP resource is temporarily unavailable.', {
        code: auditAppError.code,
        requestId: ctx.get('requestId'),
      });
    }
    if (appError.code === 'database:not_found') {
      throw new ResourceNotFoundError(uri.href, 'Resource not found.');
    }
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      appError.status >= 500 ? 'The MCP resource is temporarily unavailable.' : appError.message,
      {
        code: appError.code,
        requestId: ctx.get('requestId'),
      },
    );
  }
};
