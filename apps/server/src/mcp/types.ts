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
