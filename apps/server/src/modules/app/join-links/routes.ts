import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

// Join links admit people to the site, so only its Admins (and owner) manage them.
const admin = [isAuthenticated, requireProjectRole(MemberRole.ADMIN)] as const;
const ok = { 200: { description: 'ok' }, ...errorResponses };

const joinLinksRoutes = {
  list: createRouteConfig({ guard: [...admin], tags: ['join-links'], description: "List a site's join links and recent joins.", responses: ok }),
  create: createRouteConfig({
    guard: [...admin],
    tags: ['join-links'],
    description: 'Create a join link. The link is returned once; only its hash is stored.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  revoke: createRouteConfig({ guard: [...admin], tags: ['join-links'], description: 'Disable a join link.', responses: ok }),
  regenerate: createRouteConfig({
    guard: [...admin],
    tags: ['join-links'],
    description: "Replace a join link's token; the old link stops working.",
    responses: ok,
  }),
};

export default joinLinksRoutes;
