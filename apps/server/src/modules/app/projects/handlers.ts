import { createProjectBody, updateProjectBody } from '@plume/validators';
import { Hono } from 'hono';
import { createProject, deleteProject, getProject, listProjects, updateProject } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectsRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...projectsRoutes.list, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await listProjects(organizationId) }, 200);
  })
  .post('/', ...projectsRoutes.create, validator('json', createProjectBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await createProject(organizationId, ctx.req.valid('json')) }, 201);
  })
  .get('/:id', ...projectsRoutes.get, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await getProject(organizationId, ctx.req.param('id')) }, 200);
  })
  .patch('/:id', ...projectsRoutes.update, validator('json', updateProjectBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await updateProject(organizationId, ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .delete('/:id', ...projectsRoutes.remove, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await deleteProject(organizationId, ctx.req.param('id')) }, 200);
  });

export default app;
