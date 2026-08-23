import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  clientPrefix: 'VITE_',
  client: {
    VITE_APP_URL: z.url().default(import.meta.env.DEV ? 'http://localhost:4310' : 'https://nibleaf.com'),
  },
  runtimeEnv: { VITE_APP_URL: import.meta.env.VITE_APP_URL },
  emptyStringAsUndefined: true,
});
