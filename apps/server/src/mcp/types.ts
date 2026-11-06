import type { MemberRole } from '@nibleaf/shared/constants';
import type { McpScope } from '@nibleaf/shared/mcp';

/** How the caller authenticated: a personal API key, or an OAuth connection
 *  (an McpOAuthGrant) made by signing in from an MCP client. */
type McpCredentialKind = 'api_key' | 'oauth';

export interface McpPrincipal {
  credential: {
    kind: McpCredentialKind;
    /** ApiKey.id, or McpOAuthGrant.id for OAuth. Never mixed: audit rows and
     *  replay records store it in the column of its kind. */
    id: string;
    /** The key name, or the connected app's name. */
    name: string;
    /** OAuth only: the client's OAuth client_id. */
    clientId?: string;
    /** Effective scopes: what the credential carries, narrowed to what the
     *  actor's current role allows (and, for OAuth, to the token's scopes). */
    scopes: McpScope[];
    expiresAt: Date;
  };
  project: {
    id: string;
    name: string;
    organizationId: string;
  };
  /** The dashboard user who created the key (or who connected the OAuth app),
   *  with their CURRENT role in the project's organization, re-read on every
   *  request. `null` when the key has no live creator (legacy key, or the
   *  creator was deleted); such a key can never perform writes. */
  actor: { userId: string; role: MemberRole } | null;
}

export interface McpSuccessEnvelope {
  ok: true;
  data: unknown;
  meta: {
    requestId: string;
    projectId: string;
    capability: string;
    /** Write tools only: the result is the stored outcome of an earlier call
     *  with the same clientRequestId and arguments; nothing ran again. */
    replayed?: boolean;
  };
}

export interface McpErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
    /** Structured detail for MCP-specific errors (for example the page's
     *  currentRevision on mcp:revision_conflict). Never raw internals. */
    data?: Record<string, unknown>;
  };
}

/** The entity an audited operation touched. */
export interface McpAuditTarget {
  type: 'project' | 'page' | 'deployment';
  id: string | null;
}
