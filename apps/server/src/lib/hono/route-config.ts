import type { Context, Env, MiddlewareHandler, Next } from 'hono';
import { type DescribeRouteOptions, describeRoute } from 'hono-openapi';
import type { HonoEnv } from './context';

export type RouteMiddleware<E extends Env = HonoEnv> = MiddlewareHandler<E>;
export type RouteMiddlewareArray<E extends Env = HonoEnv> = readonly RouteMiddleware<E>[];
export type MiddlewareInput<E extends Env = HonoEnv> = RouteMiddleware<E> | RouteMiddlewareArray<E>;

export interface RouteConfigOptions<E extends Env = HonoEnv> extends DescribeRouteOptions {
  /** Guard middleware executed first (single, array, or combined). */
  guard: MiddlewareInput<E>;
  /** Optional additional middleware executed after the guard passes. */
  middleware?: MiddlewareInput<E>;
}

const unifyMiddleware = <E extends Env>(input: MiddlewareInput<E>): RouteMiddleware<E> => {
  if (typeof input === 'function') {
    return input;
  }
  if (Array.isArray(input) && input.length > 0) {
    return async (ctx: Context<E>, next: Next) => {
      let index = 0;
      const runNext = async (): Promise<void> => {
        if (index >= input.length) {
          return next();
        }
        const middleware = input[index++];
        await middleware?.(ctx, runNext);
      };
      await runNext();
    };
  }
  return (_, next) => next();
};

/**
 * Build a route's middleware tuple: [OpenAPI description, composed guard+middleware].
 * Spread into a Hono route: `app.get('/', ...routes.list, handler)`.
 */
export const createRouteConfig = <E extends Env = HonoEnv>({
  guard,
  middleware,
  ...routeConfig
}: RouteConfigOptions<E>): [RouteMiddleware<E>, RouteMiddleware<E>] => {
  const openApiMiddleware = describeRoute(routeConfig) as RouteMiddleware<E>;
  const guardHandler = unifyMiddleware<E>(guard);

  if (middleware) {
    const middlewareHandler = unifyMiddleware<E>(middleware);
    const finalMiddleware: RouteMiddleware<E> = async (ctx, next) => {
      await guardHandler(ctx, async () => {
        await middlewareHandler(ctx, next);
      });
    };
    return [openApiMiddleware, finalMiddleware];
  }

  return [openApiMiddleware, guardHandler];
};
