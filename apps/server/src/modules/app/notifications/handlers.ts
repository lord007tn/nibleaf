import { markNotificationsReadBody, notificationsListQuery } from '@nibleaf/validators';
import { Hono } from 'hono';
import { getUnreadNotificationCount, listNotifications, markNotificationsRead } from '@/actions/notifications';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import notificationsRoutes from './routes';

// The in-app notification inbox. Every route is scoped to the SESSION user —
// notifications are personal. The optional organizationId only narrows the
// caller's own inbox; it never authorizes anything.
const app = new Hono<HonoEnv>()
  .get('/', ...notificationsRoutes.list, validator('query', notificationsListQuery), async (ctx) => {
    const user = getContextUserOrThrow();
    const { cursor, organizationId } = ctx.req.valid('query');
    return ctx.json({ data: await listNotifications(user.id, cursor, organizationId) }, 200);
  })
  .get('/unread-count', ...notificationsRoutes.unreadCount, async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: { count: await getUnreadNotificationCount(user.id) } }, 200);
  })
  .post('/read', ...notificationsRoutes.markRead, validator('json', markNotificationsReadBody), async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await markNotificationsRead(user.id, ctx.req.valid('json')) }, 200);
  });

export default app;
