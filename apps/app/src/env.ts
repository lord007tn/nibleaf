import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const development = import.meta.env.DEV;

export const env = createEnv({
  clientPrefix: 'VITE_',
  client: {
    VITE_APP_URL: z.url().default(development ? 'http://localhost:4310' : 'https://nibleaf.com'),
    VITE_ADMIN_URL: z.url().default(development ? 'http://localhost:4315' : 'https://admin.nibleaf.com'),
    VITE_GITHUB_URL: z.url().default('https://github.com/lord007tn/nibleaf'),
    VITE_SITE_BASE_DOMAIN: z.string().optional(),
  },
  runtimeEnv: {
    VITE_APP_URL: import.meta.env.VITE_APP_URL,
    VITE_ADMIN_URL: import.meta.env.VITE_ADMIN_URL,
    VITE_GITHUB_URL: import.meta.env.VITE_GITHUB_URL,
    VITE_SITE_BASE_DOMAIN: import.meta.env.VITE_SITE_BASE_DOMAIN,
  },
  emptyStringAsUndefined: true,
});
