import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

// Notifications are personal: every route reads/writes only the session user's
// own rows, so the guard is plain authentication (no org/project role needed).
const notificationsRoutes = {
  list: createRouteConfig({
    guard: isAuthenticated,
    tags: ['notifications'],
    description: "List the signed-in user's notifications, newest first (cursor-paginated).",
    responses: ok,
  }),
  unreadCount: createRouteConfig({
    guard: isAuthenticated,
    tags: ['notifications'],
    description: "Count the signed-in user's unread notifications.",
    responses: ok,
  }),
  markRead: createRouteConfig({
    guard: isAuthenticated,
    tags: ['notifications'],
    description: 'Mark notifications read (specific ids, or the whole inbox).',
    responses: ok,
  }),
};

export default notificationsRoutes;
