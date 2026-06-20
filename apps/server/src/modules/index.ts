import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import appRoutes from './app';
import publicRoutes from './public';

const app = new Hono<HonoEnv>().route('/app', appRoutes).route('/public', publicRoutes);

export default app;
