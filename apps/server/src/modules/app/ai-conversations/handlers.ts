import { aiContentGapsQuery, aiConversationListQuery, aiConversationSummaryQuery } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  deleteProjectAiConversation,
  getProjectAiConversation,
  getProjectAiConversationSummary,
  listProjectAiContentGaps,
  listProjectAiConversations,
} from '@/actions/ai-conversations';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const params = z.object({ projectId: z.string().min(1), conversationId: z.uuid() });
const app = new Hono<HonoEnv>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    await next();
  })
  .get('/', ...routes.read, validator('query', aiConversationListQuery), async (c) =>
    c.json({ data: await listProjectAiConversations(getContextOrganizationIdOrThrow(), c.req.param('projectId') ?? '', c.req.valid('query')) }),
  )
  .get('/summary', ...routes.read, validator('query', aiConversationSummaryQuery), async (c) =>
    c.json({ data: await getProjectAiConversationSummary(getContextOrganizationIdOrThrow(), c.req.param('projectId') ?? '', c.req.valid('query')) }),
  )
  .get('/gaps', ...routes.read, validator('query', aiContentGapsQuery), async (c) =>
    c.json({ data: await listProjectAiContentGaps(getContextOrganizationIdOrThrow(), c.req.param('projectId') ?? '', c.req.valid('query')) }),
  )
  .get('/:conversationId', ...routes.read, validator('param', params), async (c) =>
    c.json({
      data: await getProjectAiConversation(getContextOrganizationIdOrThrow(), c.req.valid('param').projectId, c.req.valid('param').conversationId),
    }),
  )
  .delete('/:conversationId', ...routes.remove, validator('param', params), async (c) =>
    c.json({
      data: await deleteProjectAiConversation(getContextOrganizationIdOrThrow(), c.req.valid('param').projectId, c.req.valid('param').conversationId),
    }),
  );
export default app;
