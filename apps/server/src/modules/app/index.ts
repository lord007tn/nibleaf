import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import activationEvents from './activation-events/handlers';
import addons from './addons/handlers';
import ai from './ai/handlers';
import analytics from './analytics/handlers';
import apiKeys from './api-keys/handlers';
import assets from './assets/handlers';
import branches from './branches/handlers';
import comments from './comments/handlers';
import deployments from './deployments/handlers';
import domains from './domains/handlers';
import exports from './exports/handlers';
import git from './git/handlers';
import imports from './imports/handlers';
import integrations from './integrations/handlers';
import languages from './languages/handlers';
import members from './members/handlers';
import notifications from './notifications/handlers';
import openapi from './openapi/handlers';
import pages from './pages/handlers';
import projectMembers from './project-members/handlers';
import projectSettings from './project-settings/handlers';
import projects from './projects/handlers';
import readerAccess from './reader-access/handlers';
import workspace from './workspace/handlers';

const app = new Hono<HonoEnv>()
  .get('/health', (ctx) => {
    const revision = process.env.NIBLEAF_REVISION ?? 'development';
    return ctx.json({ ok: true, revision }, 200, {
      'x-nibleaf-revision': revision,
    });
  })
  .route('/activation-events', activationEvents)
  .route('/projects', projects)
  .route('/projects/:projectId/pages', pages)
  .route('/projects/:projectId/addons', addons)
  .route('/projects/:projectId/languages', languages)
  .route('/projects/:projectId/branches', branches)
  .route('/projects/:projectId/deployments', deployments)
  .route('/projects/:projectId/exports', exports)
  .route('/projects/:projectId/domains', domains)
  .route('/projects/:projectId/api-keys', apiKeys)
  .route('/projects/:projectId/assets', assets)
  .route('/projects/:projectId/analytics', analytics)
  .route('/projects/:projectId/comments', comments)
  .route('/projects/:projectId/openapi', openapi)
  .route('/projects/:projectId/members', projectMembers)
  .route('/projects/:projectId/settings', projectSettings)
  .route('/projects/:projectId/reader-access', readerAccess)
  .route('/projects/:projectId/settings/import', imports)
  .route('/projects/:projectId/integrations', integrations)
  .route('/projects/:projectId/git', git)
  .route('/projects/:projectId/ai', ai)
  .route('/workspace', workspace)
  .route('/members', members)
  .route('/notifications', notifications);

export default app;
