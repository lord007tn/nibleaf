import { MCP_SCOPES } from '@nibleaf/shared/mcp';
import { describe, expect, it } from 'vitest';
import { createApiKeyBody, rotateApiKeyBody } from './index';

describe('MCP API-key contracts', () => {
  it('deduplicates a closed, least-privilege scope set', () => {
    const parsed = createApiKeyBody.parse({
      name: 'Docs reader',
      scopes: ['mcp:connect', 'projects:read', 'projects:read'],
      expiresInDays: 30,
    });
    expect(parsed.scopes).toEqual(['mcp:connect', 'projects:read']);
    expect(parsed.expiresInDays).toBe(30);
  });

  it.each(['*', 'pages:write', 'search:write', 'search:reindex', 'usage:export', 'addons:write', 'integrations:write', 'unknown:scope'])(
    'rejects unavailable or legacy scope %s',
    (scope) => {
      expect(createApiKeyBody.safeParse({ name: 'Unsafe', scopes: ['mcp:connect', scope], expiresInDays: 30 }).success).toBe(false);
    },
  );

  it.each(MCP_SCOPES)('accepts current discoverable scope %s', (scope) => {
    expect(createApiKeyBody.safeParse({ name: 'Reader', scopes: ['mcp:connect', scope], expiresInDays: 30 }).success).toBe(true);
  });

  it('requires explicit closed scopes during rotation', () => {
    expect(rotateApiKeyBody.safeParse({ expiresInDays: 90 }).success).toBe(false);
    expect(rotateApiKeyBody.parse({ scopes: ['mcp:connect'], expiresInDays: 90 }).scopes).toEqual(['mcp:connect']);
  });

  it('requires mcp:connect after scope deduplication for create and rotate', () => {
    expect(createApiKeyBody.safeParse({ name: 'Unusable', scopes: ['projects:read', 'projects:read'], expiresInDays: 30 }).success).toBe(false);
    expect(rotateApiKeyBody.safeParse({ scopes: ['pages:read'], expiresInDays: 90 }).success).toBe(false);
  });
});
