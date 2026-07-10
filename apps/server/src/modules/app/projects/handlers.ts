import { createProjectBody, updateProjectBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { exportProjectMarkdown } from '@/actions/export';
import { createProject, deleteProject, getProject, listProjects, updateProject } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectsRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...projectsRoutes.list, async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await listProjects(user.id) }, 200);
  })
  .post('/', ...projectsRoutes.create, validator('json', createProjectBody), async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await createProject(user.id, ctx.req.valid('json')) }, 201);
  })
  .get('/:id', ...projectsRoutes.get, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await getProject(organizationId, ctx.req.param('id')) }, 200);
  })
  .get('/:id/export', ...projectsRoutes.export, async (ctx) => {
    // Guard (requireProjectMember) already verified membership in the site's org.
    const { fileName, data } = await exportProjectMarkdown(ctx.req.param('id'));
    ctx.header('Content-Type', 'application/zip');
    ctx.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return ctx.body(data as Uint8Array<ArrayBuffer>, 200);
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
