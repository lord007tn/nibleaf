import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

// The projects module mounts these at the top level, so the project id arrives
// as `:id` (not `:projectId`) — point the project-org guards at that param.
const projectsRoutes = {
  list: createRouteConfig({
    guard: isAuthenticated,
    tags: ['projects'],
    description: 'List every documentation site the user can access.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  create: createRouteConfig({
    // Any signed-in user can start a new site; they become its owner.
    guard: isAuthenticated,
    tags: ['projects'],
    description: 'Create a documentation site.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  get: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember('id')],
    tags: ['projects'],
    description: 'Retrieve a documentation site.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  export: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember('id')],
    tags: ['projects'],
    description: 'Download every page as Markdown in a zip (organized by branch/language/path, with a project.json manifest).',
    responses: { 200: { description: 'zip archive' }, ...errorResponses },
  }),
  themeRepositoryExport: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember('id')],
    tags: ['projects'],
    description: 'Download a standalone Harbor, Manuscript, or Signal repository with a vendored runtime contract and editable source code.',
    responses: { 200: { description: 'runnable theme repository zip archive' }, ...errorResponses },
  }),
  themeExport: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember('id')],
    tags: ['projects'],
    description: 'Export the draft theme as a deterministic, versioned Nibleaf theme template.',
    responses: { 200: { description: 'theme template' }, ...errorResponses },
  }),
  themeCatalog: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember('id')],
    tags: ['projects'],
    description: 'Get the sanitized theme and documentation-component capability catalog.',
    responses: { 200: { description: 'theme capability catalog' }, ...errorResponses },
  }),
  themeImport: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN, 'id')],
    tags: ['projects'],
    description: 'Preview or apply a validated Nibleaf theme template in merge or replace mode.',
    responses: { 200: { description: 'theme import preview or result' }, ...errorResponses },
  }),
  update: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN, 'id')],
    tags: ['projects'],
    description: 'Update a documentation site.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  remove: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN, 'id')],
    tags: ['projects'],
    description: 'Delete a documentation site.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default projectsRoutes;
