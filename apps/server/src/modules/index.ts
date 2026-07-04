import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import adminRoutes from './admin/handlers';
import appRoutes from './app';
import publicRoutes from './public';

const app = new Hono<HonoEnv>().route('/app', appRoutes).route('/public', publicRoutes).route('/admin', adminRoutes);

export default app;
