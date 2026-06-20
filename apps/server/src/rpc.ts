import { hc } from 'hono/client';
import type app from './routes';

// Computing the client type once here keeps consumers fast to typecheck.
export type Client = ReturnType<typeof hc<typeof app>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client => hc<typeof app>(...args);

export type { InferRequestType, InferResponseType } from 'hono/client';
