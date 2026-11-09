import { MAX_ASSET_UPLOAD_BYTES } from '@nibleaf/shared/constants';
import { confirmAssetBody, presignAssetBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { confirmAsset, deleteAsset, listAssets, presignAsset, uploadAsset } from '@/actions/assets';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import assetsRoutes from './routes';

const scope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return { organizationId, projectId };
};

const app = new Hono<HonoEnv>()
  .put('/upload/:token', ...assetsRoutes.upload, bodyLimit({ maxSize: MAX_ASSET_UPLOAD_BYTES }), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    await uploadAsset(organizationId, projectId, ctx.req.param('token'), ctx.req.raw);
    return ctx.body(null, 204);
  })
  .get('/', ...assetsRoutes.list, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await listAssets(projectId) }, 200);
  })
  .post('/presign', ...assetsRoutes.presign, validator('json', presignAssetBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await presignAsset(organizationId, projectId, ctx.req.valid('json')) }, 200);
  })
  .post('/confirm', ...assetsRoutes.confirm, validator('json', confirmAssetBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    const user = getContextUserOrThrow();
    return ctx.json({ data: await confirmAsset(organizationId, projectId, user.id, ctx.req.valid('json')) }, 201);
  })
  .delete('/:assetId', ...assetsRoutes.remove, async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await deleteAsset(organizationId, projectId, ctx.req.param('assetId')) }, 200);
  });

export default app;
