import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      POSTGRES_URL: z.url().default('postgresql://plume:plume@localhost:5442/plume'),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
