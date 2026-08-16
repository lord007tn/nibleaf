import {
  createAudienceBody,
  inviteReaderBody,
  jwtAccessConfigBody,
  projectAccessModeBody,
  readerJwtHandoffBody,
  updateAudienceBody,
  updateReaderBody,
} from '@nibleaf/validators';
import { Hono } from 'hono';
import {
  configureJwtAccess,
  createAudience,
  deleteAudience,
  emergencyRevoke,
  inviteReader,
  listReaderAccess,
  revokeReader,
  setProjectAccessMode,
  testJwtAccess,
  updateAudience,
  updateReader,
} from '@/actions/reader-access';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...routes.list, async (ctx) => ctx.json({ data: await listReaderAccess(ctx.req.param('projectId') as string) }, 200))
  .put('/mode', ...routes.updateMode, validator('json', projectAccessModeBody), async (ctx) =>
    ctx.json({ data: await setProjectAccessMode(ctx.req.param('projectId') as string, getContextUserOrThrow().id, ctx.req.valid('json')) }, 200),
  )
  .post('/audiences', ...routes.createAudience, validator('json', createAudienceBody), async (ctx) =>
    ctx.json({ data: await createAudience(ctx.req.param('projectId') as string, getContextUserOrThrow().id, ctx.req.valid('json')) }, 201),
  )
  .patch('/audiences/:audienceId', ...routes.updateAudience, validator('json', updateAudienceBody), async (ctx) =>
    ctx.json(
      {
        data: await updateAudience(
          ctx.req.param('projectId') as string,
          ctx.req.param('audienceId'),
          getContextUserOrThrow().id,
          ctx.req.valid('json'),
        ),
      },
      200,
    ),
  )
  .delete('/audiences/:audienceId', ...routes.deleteAudience, async (ctx) =>
    ctx.json({ data: await deleteAudience(ctx.req.param('projectId') as string, ctx.req.param('audienceId'), getContextUserOrThrow().id) }, 200),
  )
  .post('/readers/invite', ...routes.inviteReader, validator('json', inviteReaderBody), async (ctx) =>
    ctx.json({ data: await inviteReader(ctx.req.param('projectId') as string, getContextUserOrThrow().id, ctx.req.valid('json')) }, 201),
  )
  .patch('/readers/:readerId', ...routes.updateReader, validator('json', updateReaderBody), async (ctx) =>
    ctx.json(
      {
        data: await updateReader(ctx.req.param('projectId') as string, ctx.req.param('readerId'), getContextUserOrThrow().id, ctx.req.valid('json')),
      },
      200,
    ),
  )
  .post('/readers/:readerId/revoke', ...routes.revokeReader, async (ctx) =>
    ctx.json({ data: await revokeReader(ctx.req.param('projectId') as string, ctx.req.param('readerId'), getContextUserOrThrow().id) }, 200),
  )
  .put('/jwt', ...routes.jwt, validator('json', jwtAccessConfigBody), async (ctx) =>
    ctx.json({ data: await configureJwtAccess(ctx.req.param('projectId') as string, getContextUserOrThrow().id, ctx.req.valid('json')) }, 200),
  )
  .post('/jwt/test', ...routes.testJwt, validator('json', readerJwtHandoffBody), async (ctx) =>
    ctx.json({ data: await testJwtAccess(ctx.req.param('projectId') as string, ctx.req.valid('json').token) }, 200),
  )
  .post('/emergency-revoke', ...routes.emergency, async (ctx) =>
    ctx.json({ data: await emergencyRevoke(ctx.req.param('projectId') as string, getContextUserOrThrow().id) }, 200),
  );

export default app;
