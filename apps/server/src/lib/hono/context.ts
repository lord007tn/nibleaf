import { getContext } from 'hono/context-storage';
import type { RequestIdVariables } from 'hono/request-id';
import { AppError } from '@/errors';
import type { ApiKeyContext, AuthSession, MembershipContext, ProjectContext, SessionUser } from '@/types/auth';

export type HonoVariables = RequestIdVariables & {
  user: SessionUser | null;
  session: AuthSession | null;
  /** Current organization (workspace) id, resolved from session or api key. */
  organizationId: string | null;
  /** Current project, when authenticated via an SDK API key. */
  project: ProjectContext | null;
  /** Membership (role) of the current user in the current organization. */
  membership: MembershipContext | null;
  /** Present when the request is authenticated via an SDK API key. */
  apiKey: ApiKeyContext | null;
};

export interface HonoEnv {
  Variables: HonoVariables;
}

export const getContextUser = () => getContext<HonoEnv>().var.user;

export const getContextUserOrThrow = (): SessionUser => {
  const user = getContext<HonoEnv>().var.user;
  if (!user) {
    throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  }
  return user;
};

export const getContextSession = () => getContext<HonoEnv>().var.session;

export const getContextOrganizationId = () => getContext<HonoEnv>().var.organizationId;

export const getContextOrganizationIdOrThrow = (): string => {
  const orgId = getContext<HonoEnv>().var.organizationId;
  if (!orgId) {
    throw new AppError({ code: 'http:bad_request', message: 'No active workspace in context.' });
  }
  return orgId;
};

export const getContextMembership = () => getContext<HonoEnv>().var.membership;

export const getContextMembershipOrThrow = (): MembershipContext => {
  const membership = getContext<HonoEnv>().var.membership;
  if (!membership) {
    throw new AppError({ code: 'auth:insufficient_role', message: 'Not a member of this workspace.' });
  }
  return membership;
};

export const getContextProject = () => getContext<HonoEnv>().var.project;

export const getContextProjectOrThrow = (): ProjectContext => {
  const project = getContext<HonoEnv>().var.project;
  if (!project) {
    throw new AppError({ code: 'database:not_found', entityType: 'project', message: 'Project context not found.' });
  }
  return project;
};

export const getContextApiKey = () => getContext<HonoEnv>().var.apiKey;
