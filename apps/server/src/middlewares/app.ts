import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from '@/env';
import type { HonoEnv } from '@/lib/hono/context';
import { sessionMiddleware } from './auth';
import { localeMiddleware } from './locale';
import { securityHeaders } from './security-headers';

const app = new Hono<HonoEnv>();

app.use('*', securityHeaders());

app.use(
  '*',
  cors({
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Nibleaf-Locale', 'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name', 'Last-Event-ID'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.use('*', localeMiddleware());
app.use('*', sessionMiddleware());

export default app;
