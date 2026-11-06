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
  };
}

export interface McpErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
  };
}
