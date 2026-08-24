import {
  configurableIntegrationProviderIdSchema,
  createIntegrationDeleteConfirmationBody,
  createProjectIntegrationBody,
  deleteProjectIntegrationBody,
  integrationProviderIdSchema,
  integrationRevisionBody,
  updateProjectIntegrationBody,
  verifyProjectIntegrationBody,
} from '@nibleaf/validators';
import { Hono } from 'hono';
import {
  activateProjectIntegration,
  createIntegrationDeleteConfirmation,
  createProjectIntegration,
  deactivateProjectIntegration,
  deleteProjectIntegration,
  getProjectIntegration,
  listProjectIntegrations,
  updateProjectIntegration,
  verifyProjectIntegration,
} from '@/actions/integrations';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const parseProviderId = <TProvider extends string>(
  schema: { safeParse: (value: string) => { success: true; data: TProvider } | { success: false } },
  value: string,
) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({ code: 'integration:provider_unsupported', message: 'This integration provider is not supported.' });
  }
  return parsed.data;
};

const app = new Hono<HonoEnv>()
  .get('/', ...routes.list, async (ctx) => ctx.json({ data: await listProjectIntegrations(ctx, ctx.req.param('projectId') ?? '') }, 200))
  .get('/:providerId', ...routes.get, async (ctx) => {
    const providerId = parseProviderId(integrationProviderIdSchema, ctx.req.param('providerId'));
    return ctx.json({ data: await getProjectIntegration(ctx, ctx.req.param('projectId') ?? '', providerId) }, 200);
  })
  .post('/', ...routes.create, validator('json', createProjectIntegrationBody), async (ctx) =>
    ctx.json({ data: await createProjectIntegration(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('json')) }, 201),
  )
  .patch('/:providerId', ...routes.update, validator('json', updateProjectIntegrationBody), async (ctx) => {
    const providerId = parseProviderId(configurableIntegrationProviderIdSchema, ctx.req.param('providerId'));
    return ctx.json({ data: await updateProjectIntegration(ctx, ctx.req.param('projectId') ?? '', providerId, ctx.req.valid('json')) }, 200);
  })
  .post('/:providerId/activate', ...routes.mutate, validator('json', integrationRevisionBody), async (ctx) => {
    const providerId = parseProviderId(configurableIntegrationProviderIdSchema, ctx.req.param('providerId'));
    return ctx.json({ data: await activateProjectIntegration(ctx, ctx.req.param('projectId') ?? '', providerId, ctx.req.valid('json')) }, 200);
  })
  .post('/:providerId/deactivate', ...routes.mutate, validator('json', integrationRevisionBody), async (ctx) => {
    const providerId = parseProviderId(configurableIntegrationProviderIdSchema, ctx.req.param('providerId'));
    return ctx.json({ data: await deactivateProjectIntegration(ctx, ctx.req.param('projectId') ?? '', providerId, ctx.req.valid('json')) }, 200);
  })
  .post('/:providerId/verify', ...routes.mutate, validator('json', verifyProjectIntegrationBody), async (ctx) => {
    const providerId = parseProviderId(integrationProviderIdSchema, ctx.req.param('providerId'));
    return ctx.json({ data: await verifyProjectIntegration(ctx, ctx.req.param('projectId') ?? '', providerId, ctx.req.valid('json')) }, 200);
  })
  .post('/:providerId/delete-confirmation', ...routes.confirmation, validator('json', createIntegrationDeleteConfirmationBody), async (ctx) => {
    const providerId = parseProviderId(configurableIntegrationProviderIdSchema, ctx.req.param('providerId'));
    return ctx.json(
      { data: await createIntegrationDeleteConfirmation(ctx, ctx.req.param('projectId') ?? '', providerId, ctx.req.valid('json')) },
      200,
    );
  })
  .delete('/:providerId', ...routes.remove, validator('json', deleteProjectIntegrationBody), async (ctx) => {
    const providerId = parseProviderId(configurableIntegrationProviderIdSchema, ctx.req.param('providerId'));
    return ctx.json({ data: await deleteProjectIntegration(ctx, ctx.req.param('projectId') ?? '', providerId, ctx.req.valid('json')) }, 200);
  });

export default app;
