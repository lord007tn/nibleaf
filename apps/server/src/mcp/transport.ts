import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse, validateHostHeader } from '@modelcontextprotocol/server';
import { createLogger } from '@nibleaf/logger';
import type { Context } from 'hono';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import { recordMcpAudit } from './audit';
import { authenticateMcpRequest, mcpAuthInfo } from './auth';
import { checkMcpRateLimit } from './rate-limit';
import { createNibleafMcpServer } from './server';

const log = createLogger({ module: 'mcp-transport' });

const configuredHostname = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return value.split(':')[0]?.trim() ?? '';
  }
};

const allowedHostnames = Array.from(
  new Set([new URL(env.API_URL).hostname, new URL(env.APP_URL).hostname, ...env.MCP_ALLOWED_HOSTS.map(configuredHostname)].filter(Boolean)),
);

const transportError = (status: 400 | 403, message: string) =>
  new Response(JSON.stringify({ error: { code: 'mcp:invalid_request', message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });

const hasControlOrWhitespace = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 32 || codePoint === 127;
  });

const isSafeAuthority = (value: string) => {
  if (!value || hasControlOrWhitespace(value) || ['@', ',', '/', '?', '#', '\\'].some((character) => value.includes(character))) return false;
  try {
    const parsed = new URL(`http://${value}`);
    return (
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname.length > 0 &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.host === value.toLowerCase()
    );
  } catch {
    return false;
  }
};

const isSafeOrigin = (value: string) => {
  if (!value || hasControlOrWhitespace(value) || value.includes('@') || value.includes(',')) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname.length > 0 &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
};

const strictTransportHeaderValidationResponse = (request: Request) => {
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (host && !isSafeAuthority(host)) return transportError(400, 'Malformed host metadata.');
  if (origin && !isSafeOrigin(origin)) return transportError(400, 'Malformed origin metadata.');
  if (forwardedHost && !isSafeAuthority(forwardedHost)) return transportError(400, 'Malformed forwarded host metadata.');
  if (forwardedProto && forwardedProto !== 'http' && forwardedProto !== 'https') {
    return transportError(400, 'Malformed forwarded protocol metadata.');
  }
};

const forwardedHostValidationResponse = (request: Request) => {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const validation = validateHostHeader(forwardedHost, allowedHostnames);
    if (!validation.ok) {
      return transportError(403, 'Forwarded host is not allowed.');
    }
  }
};

const withTransportHeaders = (response: Response, limit: { limit: number; remaining: number; resetAt: number }) => {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-ratelimit-limit', String(limit.limit));
  headers.set('x-ratelimit-remaining', String(limit.remaining));
  headers.set('x-ratelimit-reset', String(Math.ceil(limit.resetAt / 1000)));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export const handleMcpRequest = async (ctx: Context<HonoEnv>): Promise<Response> => {
  const request = ctx.req.raw;
  const rejected =
    strictTransportHeaderValidationResponse(request) ??
    hostHeaderValidationResponse(request, allowedHostnames) ??
    forwardedHostValidationResponse(request) ??
    originValidationResponse(request, allowedHostnames);
  if (rejected) return rejected;

  const authenticated = await authenticateMcpRequest(ctx);
  if (authenticated instanceof Response) return authenticated;

  const limit = checkMcpRateLimit(authenticated.apiKey.id);
  if (!limit.allowed) {
    try {
      await recordMcpAudit(ctx, authenticated, {
        kind: 'tool',
        operation: 'transport_rate_limit',
        capability: 'mcp:connect',
        outcome: 'failed',
        errorCode: 'http:rate_limited',
        durationMs: 0,
      });
    } catch {
      return new Response(JSON.stringify({ error: { code: 'storage:error', message: 'The MCP audit service is unavailable.' } }), {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
      });
    }
    return withTransportHeaders(
      new Response(JSON.stringify({ error: { code: 'http:rate_limited', message: 'The MCP request limit has been reached.' } }), {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
        },
      }),
      limit,
    );
  }

  const handler = createMcpHandler(() => createNibleafMcpServer(ctx, authenticated), {
    responseMode: 'json',
    onerror: (error) => log.error({ errorName: error.name, requestId: ctx.get('requestId') }, 'MCP protocol request failed'),
  });
  try {
    return withTransportHeaders(await handler.fetch(request, { authInfo: mcpAuthInfo(authenticated) }), limit);
  } finally {
    try {
      await handler.close();
    } catch (error) {
      log.warn({ errorName: error instanceof Error ? error.name : 'UnknownError', requestId: ctx.get('requestId') }, 'MCP handler close failed');
    }
  }
};
