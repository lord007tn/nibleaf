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
  mergePreview: createRouteConfig({
    guard: [...editor],
    tags: ['branches'],
    description: "List pages changed on the default branch ('main') since this branch was created.",
    responses: ok,
  }),
  merge: createRouteConfig({
    guard: [...editor],
    tags: ['branches'],
    description:
      "Merge a branch into the default branch ('main'). Answers 409 branch:main_changed with the preview when main changed since the fork; resend with confirmPreview set to that preview's fingerprint to promote it. 409 branch:promote_blocked (a parent cycle) and branch:baseline_missing cannot be confirmed.",
    responses: ok,
  }),
  remove: createRouteConfig({ guard: [...editor], tags: ['branches'], description: 'Delete a non-default branch.', responses: ok }),
};

export default branchesRoutes;
