import type { McpPrincipal } from './types';

type Credential = Pick<McpPrincipal['credential'], 'kind' | 'id'>;

/** Key for the instance-local MCP budgets. API keys keep their id (as before
 *  OAuth); OAuth connections are namespaced so the two can never share one. */
export const mcpCredentialKey = (credential: Credential) => (credential.kind === 'oauth' ? `oauth:${credential.id}` : credential.id);

/** The audit / replay columns naming this credential: an OAuth connection is
 *  recorded as its grant, never under an API key id. */
export const mcpCredentialColumns = (credential: Credential): { apiKeyId: string } | { apiKeyId: null; oauthGrantId: string } =>
  credential.kind === 'oauth' ? { apiKeyId: null, oauthGrantId: credential.id } : { apiKeyId: credential.id };
