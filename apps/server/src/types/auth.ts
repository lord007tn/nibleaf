import type { MemberRole } from '@nibleaf/shared/constants';

export interface SessionUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
}

export interface AuthSession {
  activeOrganizationId?: string | null;
  expiresAt: Date;
  id: string;
  userId: string;
}

/** A project-bound machine credential: a personal API key, or an MCP OAuth
 *  connection (`kind: 'oauth'`, `id` = McpOAuthGrant.id). */
export interface ApiKeyContext {
  id: string;
  /** Absent means an API key (every caller before OAuth). */
  kind?: 'api_key' | 'oauth';
  projectId: string;
  scopes: string[];
}

export interface ProjectContext {
  id: string;
  name: string;
  organizationId: string;
}

export interface MembershipContext {
  organizationId: string;
  role: MemberRole;
}
