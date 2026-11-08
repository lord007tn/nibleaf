import { MemberRole } from '@nibleaf/shared/constants';
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
  remove: createRouteConfig({
    guard: [...editor],
    tags: ['assets'],
    description:
      'Delete an uploaded asset that no saved content uses: no page in any language or version, no site, language or page settings, and no published, exported or preview snapshot. Answers 409 asset:in_use and keeps the file otherwise.',
    responses: ok,
  }),
};

export default assetsRoutes;
