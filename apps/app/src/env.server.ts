import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const serverEnv = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4310),
    APP_URL: z.url().default('http://localhost:4310'),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
    INTERNAL_API_SECRET: z.string().optional(),
    CUSTOM_DOMAIN_EDGE_SECRET: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
