import { createBranchBody, mergeBranchBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createBranch, deleteBranch, getMergePreview, listBranches, mergeBranch } from '@/actions/branches';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import branchesRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return projectId;
};

/** The promote body is optional. A JSON request with an empty body (e.g. curl
 *  with only a Content-Type header) reads as `{}` instead of malformed JSON.
 *  Hono caches the body text as a promise (its type says string) and the json
 *  validator parses that cache, so seeding it is enough; the route test pins it. */
const optionalJsonBody = createMiddleware<HonoEnv>(async (ctx, next) => {
  if (ctx.req.header('Content-Type')?.includes('json') && (await ctx.req.text()).trim() === '') {
    (ctx.req.bodyCache as { text?: Promise<string> }).text = Promise.resolve('{}');
  }
  await next();
});

const app = new Hono<HonoEnv>()
  .get('/', ...branchesRoutes.list, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listBranches(projectId) }, 200);
  })
  .post('/', ...branchesRoutes.create, validator('json', createBranchBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await createBranch(projectId, ctx.req.valid('json')) }, 201);
  })
  .get('/:id/merge-preview', ...branchesRoutes.mergePreview, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getMergePreview(projectId, ctx.req.param('id')) }, 200);
  })
  .post('/:id/merge', ...branchesRoutes.merge, optionalJsonBody, validator('json', mergeBranchBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await mergeBranch(projectId, ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .delete('/:id', ...branchesRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await deleteBranch(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
