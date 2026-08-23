import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      QDRANT_URL: z.url().optional(),
      QDRANT_API_KEY: z.string().optional(),
      QDRANT_COLLECTION_ALIAS: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .default('nibleaf_search_active'),
      QDRANT_COLLECTION_VERSION: z
        .string()
        .regex(/^v[1-9][0-9]*$/)
        .default('v1'),
      QDRANT_VECTOR_SIZE: z.coerce.number().int().min(64).max(8192).default(1536),
      QDRANT_TIMEOUT_MS: z.coerce.number().int().min(250).max(120_000).default(8_000),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
