import { describe, expect, it } from 'vitest';
import { mcpCredentialColumns, mcpCredentialKey } from './credential';

describe('MCP credential identity', () => {
  it('records an OAuth connection as its grant, never as an API key', () => {
    expect(mcpCredentialColumns({ kind: 'oauth', id: 'grant-1' })).toEqual({ apiKeyId: null, oauthGrantId: 'grant-1' });
    expect(mcpCredentialColumns({ kind: 'api_key', id: 'key-1' })).toEqual({ apiKeyId: 'key-1' });
  });

  it('keeps API-key budgets unchanged and namespaces OAuth budgets', () => {
    expect(mcpCredentialKey({ kind: 'api_key', id: 'key-1' })).toBe('key-1');
    expect(mcpCredentialKey({ kind: 'oauth', id: 'key-1' })).toBe('oauth:key-1');
  });
});
