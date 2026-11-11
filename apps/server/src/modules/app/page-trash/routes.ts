import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const member = [isAuthenticated, requireProjectMember()] as const;
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const pageTrashRoutes = {
  list: createRouteConfig({
    guard: [...member],
    tags: ['pages'],
    description: "List a branch's deleted pages kept in Trash for 30 days.",
    responses: ok,
  }),
  count: createRouteConfig({
    guard: [...member],
    tags: ['pages'],
    description: "Count a branch's deleted pages in Trash (read-only).",
    responses: ok,
  }),
  restore: createRouteConfig({
    guard: [...editor],
    tags: ['pages'],
    description: 'Restore a deleted page (and its children) from Trash.',
    responses: ok,
  }),
  remove: createRouteConfig({ guard: [...editor], tags: ['pages'], description: 'Delete a page in Trash forever.', responses: ok }),
};

export default pageTrashRoutes;
