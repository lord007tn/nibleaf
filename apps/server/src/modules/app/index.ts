import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import ai from './ai/handlers';
import analytics from './analytics/handlers';
import apiKeys from './api-keys/handlers';
import assets from './assets/handlers';
import branches from './branches/handlers';
import comments from './comments/handlers';
import deployments from './deployments/handlers';
import domains from './domains/handlers';
import languages from './languages/handlers';
import members from './members/handlers';
import pages from './pages/handlers';
import projectMembers from './project-members/handlers';
import projectSettings from './project-settings/handlers';
import projects from './projects/handlers';
import workspace from './workspace/handlers';

const app = new Hono<HonoEnv>()
  .get('/health', (ctx) => ctx.json({ ok: true }))
  .route('/projects', projects)
  .route('/projects/:projectId/pages', pages)
  .route('/projects/:projectId/languages', languages)
  .route('/projects/:projectId/branches', branches)
  .route('/projects/:projectId/deployments', deployments)
  .route('/projects/:projectId/domains', domains)
  .route('/projects/:projectId/api-keys', apiKeys)
  .route('/projects/:projectId/assets', assets)
  .route('/projects/:projectId/analytics', analytics)
  .route('/projects/:projectId/comments', comments)
  .route('/projects/:projectId/members', projectMembers)
  .route('/projects/:projectId/settings', projectSettings)
  .route('/projects/:projectId/ai', ai)
  .route('/workspace', workspace)
  .route('/members', members);

export default app;
