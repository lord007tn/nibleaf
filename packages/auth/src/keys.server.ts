import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const DEV_AUTH_SECRET = 'dev-secret-change-me-please-32chars-min';

export const keys = () =>
  createEnv({
    server: {
      // In production the session-signing secret MUST be a strong, non-default
      // value — otherwise sessions are signed with a publicly known key. This
      // refine fails fast at boot (the unset env falls back to DEV_AUTH_SECRET,
      // which is rejected under NODE_ENV=production).
      BETTER_AUTH_SECRET: z
        .string()
        .min(1)
        .default(DEV_AUTH_SECRET)
        .refine((value) => process.env.NODE_ENV !== 'production' || (value.length >= 32 && value !== DEV_AUTH_SECRET), {
          message: 'BETTER_AUTH_SECRET must be a strong (≥32 char) non-default value in production. Generate one with `openssl rand -hex 32`.',
        }),
      BETTER_AUTH_URL: z.url().default('http://localhost:4310'),
      TRUSTED_ORIGINS: z.string().default('http://localhost:4310,http://localhost:4311,http://localhost:4315').transform(csv),
      GOOGLE_CLIENT_ID: z.string().optional(),
      GOOGLE_CLIENT_SECRET: z.string().optional(),
      // Optional: refuse ALL new sign-ups (email OTP and social). Existing
      // accounts keep signing in. Useful for closed self-hosted instances and as
      // an emergency brake on the public cloud. Default off.
      DISABLE_SIGNUP: z
        .string()
        .optional()
        .transform((value) => value === 'true' || value === '1'),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
