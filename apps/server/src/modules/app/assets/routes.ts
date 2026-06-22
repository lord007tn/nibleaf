import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const assetsRoutes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['assets'],
    description: 'List uploaded assets.',
    responses: ok,
  }),
  presign: createRouteConfig({ guard: [...editor], tags: ['assets'], description: 'Presign a direct upload URL.', responses: ok }),
  confirm: createRouteConfig({
    guard: [...editor],
    tags: ['assets'],
    description: 'Record an uploaded asset.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
};

export default assetsRoutes;
