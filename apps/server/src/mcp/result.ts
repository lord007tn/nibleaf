import {
  type CallToolResult,
  ProtocolError,
  ProtocolErrorCode,
  type ReadResourceResult,
  ResourceNotFoundError,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import type { Prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { MemberRole } from '@nibleaf/shared/constants';
import { MCP_SCOPE_MIN_ROLE, type McpScope } from '@nibleaf/shared/mcp';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { beginMcpWriteAudit, recordMcpAudit, settleMcpWriteAudit } from './audit';
import { mcpCredentialKey } from './credential';
import {
  abandonMcpIdempotentWrite,
  beginMcpIdempotentWrite,
  CLIENT_REQUEST_ID_PATTERN,
  completeMcpIdempotentWrite,
  hashMcpArguments,
} from './idempotency';
import { dashboardLinks } from './links';
import { checkMcpWriteRateLimit } from './rate-limit';
import type { McpAuditTarget, McpErrorEnvelope, McpPrincipal, McpSuccessEnvelope } from './types';

const log = createLogger({ module: 'mcp-tools' });

const retryableCodes = new Set([
  'http:rate_limited',
  'provider:unavailable',
  'storage:error',
  'search:unavailable',
  'mcp:disabled',
  'mcp:idempotency_in_progress',
  'mcp:publish_in_progress',
  'publish:busy',
]);

const toolContent = (value: McpSuccessEnvelope | McpErrorEnvelope) => [{ type: 'text' as const, text: JSON.stringify(value) }];

/** Only errors the MCP layer raises itself carry structured data to the client;
 *  action errors keep their details (ids, internal issue lists) server-side. */
const exposesErrorData = (appError: AppError) => appError.code.startsWith('mcp:') || appError.code === 'http:rate_limited';

const UNAVAILABLE_MESSAGE = 'The MCP operation is temporarily unavailable.';

const toolErrorResult = (ctx: Context<HonoEnv>, appError: AppError, unavailableMessage = UNAVAILABLE_MESSAGE): CallToolResult => {
  const envelope: McpErrorEnvelope = {
    ok: false,
    error: {
      code: appError.code,
      message: appError.status >= 500 ? unavailableMessage : appError.message,
      retryable: retryableCodes.has(appError.code),
      requestId: ctx.get('requestId'),
      ...(appError.details && exposesErrorData(appError) ? { data: appError.details } : {}),
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
    if (!principal.credential.scopes.includes(capability)) {
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
  /** `text/markdown`: the action returns `{ text, meta }`; the text is served
   *  as-is with `meta` in `_meta` and marked untrusted. Default: the JSON
   *  `{ ok, data }` envelope. */
  mimeType: 'application/json' | 'text/markdown' = 'application/json',
): Promise<ReadResourceResult> => {
  const startedAt = performance.now();
  try {
    if (!principal.credential.scopes.includes(capability)) {
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
    if (mimeType === 'text/markdown') {
      const document = data as { text: string; meta?: Record<string, unknown> };
      return { contents: [{ uri: uri.href, mimeType, text: document.text, _meta: { ...document.meta, contentTrust: 'untrusted' } }] };
    }
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

/** Lists `schema` as the tool's input JSON Schema but accepts any arguments at
 *  the SDK layer, so `runMcpWriteTool` validates them itself and a malformed
 *  write attempt is audited like every other failed write. */
export const auditedInputSchema = (schema: z.ZodType): StandardSchemaWithJSON => ({
  '~standard': {
    version: 1,
    vendor: 'nibleaf',
    validate: (value: unknown) => ({ value }),
    jsonSchema: schema['~standard'].jsonSchema,
  },
});

export type McpActor = NonNullable<McpPrincipal['actor']>;

export interface McpWriteOutcome {
  data: unknown;
  /** Compact result stored for clientRequestId replay: ids, revision, status,
   *  and every flag, warning and next step the response carries, so a replay
   *  means the same as the first answer. Never page content. */
  stored?: Prisma.InputJsonObject;
  /** The entity actually touched, when known only after running (a created page). */
  target?: McpAuditTarget;
}

export interface McpWriteToolSpec<Schema extends z.ZodType> {
  operation: string;
  capability: McpScope;
  schema: Schema;
  /** Accepts `clientRequestId` and replays identical retries. */
  idempotent: boolean;
  /** Counts against the per-key MCP_WRITE_RATE_LIMIT_PER_MIN budget. */
  rateLimited: boolean;
  /** The audited target before running, read leniently from the raw arguments
   *  so a call that fails validation is still attributed. */
  target: (raw: Record<string, unknown>) => McpAuditTarget;
  run: (args: z.output<Schema>, actor: McpActor) => Promise<McpWriteOutcome>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

const formatIssues = (issues: ReadonlyArray<z.core.$ZodIssue>) =>
  issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'arguments'}: ${issue.message}`)
    .join('; ')
    .slice(0, 600);

const validationError = (issues: ReadonlyArray<z.core.$ZodIssue>) =>
  issues.some((issue) => issue.path[0] === 'confirm')
    ? new AppError({
        code: 'mcp:confirmation_required',
        message:
          'Publishing requires confirm: true. Set it only after showing the preview_publish summary to the person you are helping and receiving their explicit approval.',
      })
    : new AppError({ code: 'validation:failed', message: `Invalid arguments: ${formatIssues(issues)}` });

const storedTarget = (stored: Record<string, unknown>): McpAuditTarget | null =>
  (stored.targetType === 'page' || stored.targetType === 'project' || stored.targetType === 'deployment') && typeof stored.targetId === 'string'
    ? { type: stored.targetType, id: stored.targetId }
    : null;

/**
 * Run a state-changing MCP tool with the checks the dashboard applies, in
 * order: scope; a live actor whose CURRENT role reaches MEMBER and the scope's
 * minimum role (mirroring `requireProjectRole(MEMBER)` on the page and publish
 * routes); argument validation; the per-key write budget; clientRequestId
 * replay; the action. Every attempt, whatever its outcome, writes exactly one
 * audit row with the actor, target and clientRequestId (never the inputs).
 */
export const runMcpWriteTool = async <Schema extends z.ZodType>(
  ctx: Context<HonoEnv>,
  principal: McpPrincipal,
  spec: McpWriteToolSpec<Schema>,
  input: unknown,
): Promise<CallToolResult> => {
  const startedAt = performance.now();
  const raw = isPlainObject(input) ? input : {};
  let target: McpAuditTarget | null = spec.target(raw);
  const clientRequestId =
    spec.idempotent && typeof raw.clientRequestId === 'string' && CLIENT_REQUEST_ID_PATTERN.test(raw.clientRequestId) ? raw.clientRequestId : null;
  let outcome: 'succeeded' | 'replayed' = 'succeeded';
  let wrote = false;
  let data: unknown;
  // The audit row a non-replayed write records before it runs.
  let auditId: string | null = null;
  try {
    if (!principal.credential.scopes.includes(spec.capability)) {
      throw new AppError({ code: 'mcp:scope_required', message: `This tool requires the ${spec.capability} scope.` });
    }
    const actor = principal.actor;
    if (!actor) {
      throw new AppError({
        code: 'mcp:actor_required',
        message: 'This API key has no active creator, so it cannot change anything. Ask a project member to create a new key in the dashboard.',
      });
    }
    if (!(roleAtLeast(actor.role, MemberRole.MEMBER) && roleAtLeast(actor.role, MCP_SCOPE_MIN_ROLE[spec.capability]))) {
      throw new AppError({ code: 'auth:insufficient_role', message: "The key creator's current project role does not allow this change." });
    }
    const parsed = spec.schema.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error.issues);
    if (spec.rateLimited) {
      const limit = checkMcpWriteRateLimit(mcpCredentialKey(principal.credential));
      if (!limit.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
        throw new AppError({
          code: 'http:rate_limited',
          message: `This key reached its limit of ${limit.limit} write calls per minute. Retry after ${retryAfterSeconds} seconds.`,
          details: { retryAfterSeconds },
        });
      }
    }

    const start = clientRequestId
      ? await beginMcpIdempotentWrite(
          { projectId: principal.project.id, credential: principal.credential, operation: spec.operation, clientRequestId },
          hashMcpArguments(parsed.data as Record<string, unknown>),
        )
      : null;
    if (start?.kind === 'replay') {
      outcome = 'replayed';
      const stored = isPlainObject(start.result) ? start.result : {};
      data = { ...stored, replayed: true };
      target = storedTarget(stored) ?? target;
    } else {
      let result: McpWriteOutcome;
      try {
        auditId = await beginMcpWriteAudit(ctx, principal, {
          kind: 'tool',
          operation: spec.operation,
          capability: spec.capability,
          target,
          clientRequestId,
          durationMs: performance.now() - startedAt,
        });
        result = await spec.run(parsed.data, actor);
      } catch (error) {
        if (start) await abandonMcpIdempotentWrite(start.recordId).catch(() => undefined);
        throw error;
      }
      wrote = true;
      data = result.data;
      if (result.target) target = result.target;
      if (start) {
        const stored: Prisma.InputJsonObject = { ...(result.stored ?? {}), ...(target ? { targetType: target.type, targetId: target.id } : {}) };
        await completeMcpIdempotentWrite(start.recordId, stored).catch((error: unknown) => {
          // The write already happened; without the stored result a retry with
          // this id reports in-progress instead of replaying, never re-writes.
          log.error(
            { errorName: error instanceof Error ? error.name : 'UnknownError', operation: spec.operation, requestId: ctx.get('requestId') },
            'MCP idempotency result could not be stored',
          );
        });
      }
    }
    // Dashboard links are rebuilt from the bound website and the final target on
    // every answer, first or replayed, and never stored in the replay record.
    const links = dashboardLinks(spec.operation, principal.project.id, target);
    const envelope: McpSuccessEnvelope = {
      ok: true,
      data: isPlainObject(data) && Object.keys(links).length > 0 ? { ...data, ...links } : data,
      meta: {
        requestId: ctx.get('requestId'),
        projectId: principal.project.id,
        capability: spec.capability,
        ...(outcome === 'replayed' ? { replayed: true } : {}),
      },
    };
    if (auditId) await settleMcpWriteAudit(ctx, auditId, { outcome: 'succeeded', target, durationMs: performance.now() - startedAt });
    else
      await recordMcpAudit(ctx, principal, {
        kind: 'tool',
        operation: spec.operation,
        capability: spec.capability,
        outcome,
        target,
        clientRequestId,
        durationMs: performance.now() - startedAt,
      });
    return { content: toolContent(envelope), structuredContent: envelope };
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError({ code: 'http:internal', message: 'The MCP operation failed.' });
    if (!(error instanceof AppError)) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError', operation: spec.operation, requestId: ctx.get('requestId') },
        'unhandled MCP write tool error',
      );
    }
    if (wrote) {
      // Only settling the audit row can fail after the write ran; the row
      // recorded before the write still shows it was attempted. The change is
      // saved, so say so instead of inviting a blind retry.
      const envelope: McpSuccessEnvelope = {
        ok: true,
        data,
        meta: { requestId: ctx.get('requestId'), projectId: principal.project.id, capability: spec.capability, auditPending: true },
      };
      return { content: toolContent(envelope), structuredContent: envelope };
    }
    try {
      if (auditId)
        await settleMcpWriteAudit(ctx, auditId, { outcome: 'failed', errorCode: appError.code, target, durationMs: performance.now() - startedAt });
      else
        await recordMcpAudit(ctx, principal, {
          kind: 'tool',
          operation: spec.operation,
          capability: spec.capability,
          outcome: 'failed',
          errorCode: appError.code,
          target,
          clientRequestId,
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
