import { prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import { gitConflictResolutionBody, gitConnectionBody, gitOperationBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { connectGitHub, gitWorkspaceStatus, queueGitOperation, resolveGitConflict, rotateConnectionWebhookSecret } from '@/actions/git/workflow';
import { getContextMembership, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...routes.status, async (ctx) => {
    const projectId = ctx.req.param('projectId') ?? '';
    const status = await gitWorkspaceStatus(projectId);
    if (status && !roleAtLeast(getContextMembership()?.role ?? '', MemberRole.ADMIN)) {
      // Audit records can reveal repository administration details; regular
      // authors still receive file, operation, conflict, PR, and preview state.
      status.auditEvents = [];
    }
    return ctx.json({ data: status }, 200);
  })
  .put('/connection', ...routes.connect, validator('json', gitConnectionBody), async (ctx) => {
    const user = getContextUserOrThrow();
    const result = await connectGitHub(ctx.req.param('projectId') ?? '', user.id, ctx.req.valid('json'));
    return ctx.json({ data: result }, 200);
  })
  .delete('/connection', ...routes.disconnect, async (ctx) => {
    const projectId = ctx.req.param('projectId') ?? '';
    const connection = await prisma.gitConnection.findUnique({ where: { projectId } });
    if (connection) {
      await prisma.gitAuditEvent.create({
        data: { connectionId: connection.id, projectId, actorUserId: getContextUserOrThrow().id, action: 'connection.disconnected' },
      });
      // Audit lives under the connection and is removed by cascade. The
      // sensitive action is also mirrored to the durable platform event table.
      await prisma.platformEvent.create({
        data: { type: 'git_connection_disconnected', userId: getContextUserOrThrow().id, projectId, metadata: { repository: connection.repository } },
      });
      await prisma.gitConnection.delete({ where: { id: connection.id } });
    }
    return ctx.json({ data: { disconnected: true } }, 200);
  })
  .post('/operations', ...routes.operation, validator('json', gitOperationBody), async (ctx) => {
    const operation = await queueGitOperation(ctx.req.param('projectId') ?? '', getContextUserOrThrow().id, ctx.req.valid('json'));
    return ctx.json({ data: operation }, 202);
  })
  .post('/conflicts/:conflictId/resolve', ...routes.resolve, validator('json', gitConflictResolutionBody), async (ctx) => {
    const body = ctx.req.valid('json');
    const conflict = await resolveGitConflict(
      ctx.req.param('projectId') ?? '',
      ctx.req.param('conflictId'),
      getContextUserOrThrow().id,
      body.resolution,
      body.content,
    );
    return ctx.json({ data: conflict }, 200);
  })
  .post('/webhook-secret', ...routes.webhookSecret, async (ctx) => {
    const secret = await rotateConnectionWebhookSecret(ctx.req.param('projectId') ?? '', getContextUserOrThrow().id);
    return ctx.json({ data: { webhookSecret: secret } }, 200);
  });

export default app;
