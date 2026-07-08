import { logger } from '@nibleaf/logger';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from './index';

interface ErrorMiddlewareOptions {
  isDevelopment: boolean;
}

/** Global error handler: converts AppError / HTTPException / unknown into JSON responses. */
export const errorMiddleware =
  ({ isDevelopment }: ErrorMiddlewareOptions) =>
  (err: Error, ctx: Context) => {
    if (err instanceof AppError) {
      if (err.status >= 500) {
        logger.error({ err, code: err.code }, 'AppError (server)');
      } else {
        logger.debug({ code: err.code, message: err.message }, 'AppError (client)');
      }
      return ctx.json(err.toJSON(), err.status);
    }

    if (err instanceof HTTPException) {
      return ctx.json({ error: { code: 'http:error', message: err.message } }, err.status);
    }

    logger.error({ err }, 'Unhandled error');
    return ctx.json(
      {
        error: {
          code: 'http:internal',
          message: isDevelopment && err instanceof Error ? err.message : 'Internal server error',
          ...(isDevelopment && err instanceof Error ? { stack: err.stack } : {}),
        },
      },
      500 as ContentfulStatusCode,
    );
  };
