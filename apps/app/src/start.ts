import { createCsrfMiddleware, createStart } from '@tanstack/react-start';
import { apiResponseErrorAdapter } from '@/hooks/api/api-error-serialization';

/**
 * App-wide TanStack Start options.
 *
 * Declaring a start instance replaces Start's built-in defaults, so the default
 * request middleware is registered here explicitly, exactly as Start configures
 * it without an instance: server functions answer same-origin requests only.
 * Keep it first when adding request middleware.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })],
  serializationAdapters: [apiResponseErrorAdapter],
}));
