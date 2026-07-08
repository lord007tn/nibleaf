import { addDomainBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { addDomain, deleteDomain, listDomains, setPrimaryDomain, verifyDomain } from '@/actions/domains';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import domainsRoutes from './routes';

const scope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return { organizationId, projectId };
};

const app = new Hono<HonoEnv>()
  .get('/', ...domainsRoutes.list, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await listDomains(projectId) }, 200);
  })
  .post('/', ...domainsRoutes.add, validator('json', addDomainBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await addDomain(organizationId, projectId, ctx.req.valid('json')) }, 201);
  })
  .post('/:id/verify', ...domainsRoutes.verify, async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await verifyDomain(organizationId, projectId, ctx.req.param('id')) }, 200);
  })
  .post('/:id/primary', ...domainsRoutes.primary, async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await setPrimaryDomain(organizationId, projectId, ctx.req.param('id')) }, 200);
  })
  .delete('/:id', ...domainsRoutes.remove, async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await deleteDomain(organizationId, projectId, ctx.req.param('id')) }, 200);
  });

export default app;
