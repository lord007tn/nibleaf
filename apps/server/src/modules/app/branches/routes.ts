import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const branchesRoutes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['branches'],
    description: "List a project's branches.",
    responses: ok,
  }),
  create: createRouteConfig({
    guard: [...editor],
    tags: ['branches'],
    description: 'Create a branch by forking another.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  merge: createRouteConfig({
    guard: [...editor],
    tags: ['branches'],
    description: "Merge a branch into the default branch ('main').",
    responses: ok,
  }),
  remove: createRouteConfig({ guard: [...editor], tags: ['branches'], description: 'Delete a non-default branch.', responses: ok }),
};

export default branchesRoutes;
