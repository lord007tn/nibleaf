import type { MemberRole } from '@plume/shared/constants';

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

export interface ApiKeyContext {
  id: string;
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
