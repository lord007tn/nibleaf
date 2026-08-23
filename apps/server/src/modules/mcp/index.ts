import { Hono } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';
import { handleMcpRequest } from '@/mcp/transport';

const app = new Hono<HonoEnv>().on(['GET', 'POST', 'DELETE'], ['/', '/*'], handleMcpRequest);

export default app;
