import type { MemberRole } from '@nibleaf/shared/constants';
import type { McpScope } from '@nibleaf/shared/mcp';

export interface McpPrincipal {
  apiKey: {
    id: string;
    name: string;
    scopes: McpScope[];
    expiresAt: Date;
  };
  project: {
    id: string;
    name: string;
    organizationId: string;
  };
  /** The dashboard user who created the key, with their CURRENT role in the
   *  project's organization, re-read on every request. `null` when the key has
   *  no live creator (legacy key, or the creator was deleted); such a key can
   *  never perform writes. */
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
