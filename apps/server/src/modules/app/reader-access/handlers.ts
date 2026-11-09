import {
  createAudienceBody,
  inviteReaderBody,
  inviteReadersBody,
  jwtAccessConfigBody,
  projectAccessModeBody,
  readerAccessRequestsSettingBody,
  readerEmailDomainsBody,
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
  inviteReaders,
  listReaderAccess,
  resendReaderInvitation,
  revokeReader,
  setProjectAccessMode,
  setReaderEmailDomains,
  testJwtAccess,
  updateAudience,
  updateReader,
} from '@/actions/reader-access';
import { approveReaderAccessRequest, declineReaderAccessRequest, setReaderAccessRequests } from '@/actions/reader-access-requests';
import { invalidatePublishedSiteConfig } from '@/actions/sites';
import { getContextLocale, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...routes.list, async (ctx) => ctx.json({ data: await listReaderAccess(ctx.req.param('projectId') as string) }, 200))
  .put('/mode', ...routes.updateMode, validator('json', projectAccessModeBody), async (ctx) => {
    const projectId = ctx.req.param('projectId') as string;
    const data = await setProjectAccessMode(projectId, getContextUserOrThrow().id, ctx.req.valid('json'));
    // Apply the new gate on this instance now, not after the 15-second live
    // settings cache expires: a site switched to private must stop serving at once.
    invalidatePublishedSiteConfig(projectId);
    return ctx.json({ data }, 200);
  })
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
    ctx.json(
      { data: await inviteReader(ctx.req.param('projectId') as string, getContextUserOrThrow().id, ctx.req.valid('json'), getContextLocale()) },
      201,
    ),
  )
  .post('/readers/invite-bulk', ...routes.inviteReaders, validator('json', inviteReadersBody), async (ctx) =>
    ctx.json(
      { data: await inviteReaders(ctx.req.param('projectId') as string, getContextUserOrThrow().id, ctx.req.valid('json'), getContextLocale()) },
      201,
    ),
  )
  .post('/readers/:readerId/resend', ...routes.resendInvitation, async (ctx) =>
    ctx.json(
      {
        data: await resendReaderInvitation(
          ctx.req.param('projectId') as string,
          ctx.req.param('readerId'),
          getContextUserOrThrow().id,
          getContextLocale(),
        ),
      },
      200,
    ),
  )
  .put('/domains', ...routes.emailDomains, validator('json', readerEmailDomainsBody), async (ctx) =>
    ctx.json({ data: await setReaderEmailDomains(ctx.req.param('projectId') as string, getContextUserOrThrow().id, ctx.req.valid('json')) }, 200),
  )
  .put('/requests-setting', ...routes.accessRequestsSetting, validator('json', readerAccessRequestsSettingBody), async (ctx) => {
    const projectId = ctx.req.param('projectId') as string;
    const data = await setReaderAccessRequests(projectId, getContextUserOrThrow().id, ctx.req.valid('json'));
    // The sign-in screen shows "Ask for access" from the live settings.
    invalidatePublishedSiteConfig(projectId);
    return ctx.json({ data }, 200);
  })
  .post('/requests/:requestId/approve', ...routes.approveAccessRequest, async (ctx) =>
    ctx.json(
      {
        data: await approveReaderAccessRequest(
          ctx.req.param('projectId') as string,
          ctx.req.param('requestId'),
          getContextUserOrThrow().id,
          getContextLocale(),
        ),
      },
      200,
    ),
  )
  .post('/requests/:requestId/decline', ...routes.declineAccessRequest, async (ctx) =>
    ctx.json(
      { data: await declineReaderAccessRequest(ctx.req.param('projectId') as string, ctx.req.param('requestId'), getContextUserOrThrow().id) },
      200,
    ),
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
