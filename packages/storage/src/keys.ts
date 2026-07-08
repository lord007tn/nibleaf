import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      // Any S3-compatible store. maxio is the local/self-host default.
      STORAGE_PROVIDER: z.enum(['maxio', 'minio', 's3', 'r2', 'b2']).default('maxio'),
      // Internal endpoint used for server→storage operations (e.g. `maxio:9000`).
      STORAGE_ENDPOINT: z.string().optional(),
      // Browser-reachable endpoint used to SIGN presigned upload/download URLs
      // (e.g. `http://localhost:9300`). Falls back to STORAGE_ENDPOINT when unset —
      // needed in containerized setups where the internal host isn't reachable by the browser.
      STORAGE_PUBLIC_ENDPOINT: z.string().optional(),
      STORAGE_REGION: z.string().default('auto'),
      STORAGE_ACCESS_KEY_ID: z.string().default('nibleafadmin'),
      STORAGE_SECRET_ACCESS_KEY: z.string().default('nibleafadmin123'),
      STORAGE_BUCKET: z.string().default('nibleaf'),
      STORAGE_FORCE_PATH_STYLE: z.stringbool().default(true),
      STORAGE_PUBLIC_URL: z.string().optional(),
      CDN_URL: z.string().optional(),
      STORAGE_CORS_ALLOWED_ORIGINS: z
        .string()
        .default('http://localhost:4310')
        .transform((value) =>
          value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
        ),
      STORAGE_AUTO_CORS: z.stringbool().default(true),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
