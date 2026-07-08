import { createLanguageBody, updateLanguageBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { createLanguage, deleteLanguage, listLanguages, updateLanguage } from '@/actions/languages';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import languagesRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return projectId;
};

const app = new Hono<HonoEnv>()
  .get('/', ...languagesRoutes.list, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listLanguages(projectId) }, 200);
  })
  .post('/', ...languagesRoutes.create, validator('json', createLanguageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await createLanguage(projectId, ctx.req.valid('json')) }, 201);
  })
  .patch('/:id', ...languagesRoutes.update, validator('json', updateLanguageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await updateLanguage(projectId, ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .delete('/:id', ...languagesRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await deleteLanguage(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
