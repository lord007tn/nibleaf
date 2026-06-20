import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const keys = () =>
  createEnv({
    server: {
      BETTER_AUTH_SECRET: z.string().min(1).default('dev-secret-change-me-please-32chars-min'),
      BETTER_AUTH_URL: z.url().default('http://localhost:4310'),
      TRUSTED_ORIGINS: z.string().default('http://localhost:4310,http://localhost:4311,http://localhost:4313').transform(csv),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
