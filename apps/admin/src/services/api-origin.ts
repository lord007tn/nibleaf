import { createIsomorphicFn } from '@tanstack/react-start';
import { serverEnv } from '@/env.server';
import { APP_URL } from '@/lib/links';

// SSR uses the admin listener's internal /api proxy. Browsers retain the shared
// app origin so Better Auth impersonation creates the customer's session there.
export const apiOrigin = createIsomorphicFn()
  .server(() => `http://localhost:${serverEnv.NITRO_PORT ?? serverEnv.PORT}`)
  .client(() => APP_URL);
