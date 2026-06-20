import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import { sessionMiddleware } from './auth';
import { securityHeaders } from './security-headers';

const app = new Hono<HonoEnv>();

app.use('*', securityHeaders());

app.use(
  '*',
  cors({
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.use('*', sessionMiddleware());

export default app;
