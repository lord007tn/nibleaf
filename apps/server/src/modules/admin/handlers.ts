import { adminSetRoleBody } from '@midad/validators';
import { Hono } from 'hono';
import { deleteWaitlistEntry, getAdminOverview, listAdminSites, listAdminUsers, listWaitlist, setUserRole } from '@/actions/admin';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import adminRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/overview', ...adminRoutes.overview, async (ctx) => ctx.json({ data: await getAdminOverview() }, 200))
  .get('/users', ...adminRoutes.users, async (ctx) => ctx.json({ data: await listAdminUsers() }, 200))
  .post('/users/:id/role', ...adminRoutes.setRole, validator('json', adminSetRoleBody), async (ctx) =>
    ctx.json({ data: await setUserRole(ctx.req.param('id'), ctx.req.valid('json').role) }, 200),
  )
  .get('/sites', ...adminRoutes.sites, async (ctx) => ctx.json({ data: await listAdminSites() }, 200))
  .get('/waitlist', ...adminRoutes.waitlist, async (ctx) => ctx.json({ data: await listWaitlist() }, 200))
  .delete('/waitlist/:id', ...adminRoutes.deleteWaitlist, async (ctx) => ctx.json({ data: await deleteWaitlistEntry(ctx.req.param('id')) }, 200));

export default app;
