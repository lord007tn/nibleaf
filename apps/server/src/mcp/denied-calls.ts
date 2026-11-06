import { isMcpWriteScope, type McpScope } from '@nibleaf/shared/mcp';
import type { Context } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import { recordMcpAudit } from './audit';
import { contentWriteTools } from './content-write';
import type { McpAuditTarget, McpPrincipal } from './types';

const writeToolScopes = new Map<string, McpScope>(contentWriteTools.filter(([, scope]) => isMcpWriteScope(scope)));
const idShaped = /^[A-Za-z0-9_-]{1,64}$/;
const requestIdShaped = /^[A-Za-z0-9._:-]{8,128}$/;

type JsonRpcCall = { method?: unknown; params?: { name?: unknown; arguments?: unknown } };

const targetOf = (args: unknown, principal: McpPrincipal): McpAuditTarget => {
  const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  for (const key of ['pageId', 'sourcePageId']) {
    const value = raw[key];
    if (typeof value === 'string' && idShaped.test(value)) return { type: 'page', id: value };
  }
  return { type: 'project', id: principal.project.id };
};

/** Whether this key lacks any write scope, i.e. could make a denied write call. */
export const mayMakeDeniedWriteCalls = (principal: McpPrincipal) =>
  [...writeToolScopes.values()].some((scope) => !principal.credential.scopes.includes(scope));

/**
 * Read the request body once, up to `maxBytes + 1` bytes, and return a request
 * rebuilt from exactly those bytes for the protocol handler. Reading once (no
 * tee) keeps the body and the audit view identical. A body over the limit is
 * forwarded truncated just past the limit, so the SDK still answers its own 413.
 */
export const bufferMcpRequest = async (request: Request, maxBytes: number): Promise<{ request: Request; text: string | null }> => {
  if (request.method !== 'POST' || !request.body) return { request, text: null };
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return { request, text: null };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
  }
  const bytes = Buffer.concat(chunks);
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  const rebuilt = new Request(request.url, { method: request.method, headers, body: bytes, signal: request.signal });
  return { request: rebuilt, text: total > maxBytes ? null : new TextDecoder().decode(bytes) };
};

/**
 * Write tools a key may not use are left out of tools/list, so the SDK answers
 * a call to one with "tool not found" before any tool code runs. Those attempts
 * still belong in the audit trail: record one failed row per denied write call
 * (actor, target, client request id; never the arguments themselves).
 */
export const auditDeniedWriteCalls = async (ctx: Context<HonoEnv>, principal: McpPrincipal, bodyText: string | null) => {
  if (bodyText === null) return;
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return;
  }
  const calls = (Array.isArray(body) ? body : [body]) as JsonRpcCall[];
  for (const call of calls) {
    if (call?.method !== 'tools/call' || typeof call.params?.name !== 'string') continue;
    const scope = writeToolScopes.get(call.params.name);
    if (!scope || principal.credential.scopes.includes(scope)) continue;
    const args = call.params.arguments as Record<string, unknown> | undefined;
    const clientRequestId = typeof args?.clientRequestId === 'string' && requestIdShaped.test(args.clientRequestId) ? args.clientRequestId : null;
    await recordMcpAudit(ctx, principal, {
      kind: 'tool',
      operation: call.params.name,
      capability: scope,
      outcome: 'failed',
      errorCode: 'mcp:scope_required',
      target: targetOf(args, principal),
      clientRequestId,
      durationMs: 0,
    });
  }
};
