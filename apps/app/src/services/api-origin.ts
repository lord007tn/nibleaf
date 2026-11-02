import { createIsomorphicFn } from '@tanstack/react-start';
import { serverEnv } from '@/env.server';

// SSR reaches the listener inside this container, including when its public
// hostname or mapped port differs. Shared with server.ts SELF so
// its request-scoped cookie, authorization and visitor-IP forwarding applies.
export const apiOrigin = createIsomorphicFn()
  .server(() => `http://localhost:${serverEnv.NITRO_PORT ?? serverEnv.PORT}`)
  .client(() => window.location.origin);
