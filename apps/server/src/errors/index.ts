import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ErrorCode = {
  'http:bad_request': 400,
  'http:unauthorized': 401,
  'http:forbidden': 403,
  'http:not_found': 404,
  'http:conflict': 409,
  'http:unprocessable': 422,
  'http:rate_limited': 429,
  'http:internal': 500,
  'auth:no_user': 401,
  'auth:invalid_session': 401,
  'auth:invalid_api_key': 401,
  'auth:insufficient_role': 403,
  'validation:failed': 422,
  'database:not_found': 404,
  'database:conflict': 409,
  'storage:error': 502,
  'search:unavailable': 503,
} as const;

export type ErrorCode = keyof typeof ErrorCode;

export interface AppErrorOptions {
  cause?: unknown;
  code: ErrorCode;
  details?: Record<string, unknown>;
  entityType?: string;
  message?: string;
}

/** Application error carrying a stable code that maps to an HTTP status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly entityType?: string;
  readonly details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message ?? options.code);
    this.name = 'AppError';
    this.code = options.code;
    this.status = ErrorCode[options.code] as ContentfulStatusCode;
    this.entityType = options.entityType;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.entityType ? { entityType: this.entityType } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const notFound = (entityType: string, details?: Record<string, unknown>) =>
  new AppError({ code: 'database:not_found', entityType, message: `${entityType} not found`, details });

export const conflict = (message: string, details?: Record<string, unknown>) => new AppError({ code: 'database:conflict', message, details });

export const badRequest = (message: string, details?: Record<string, unknown>) => new AppError({ code: 'http:bad_request', message, details });

export const forbidden = (message: string, details?: Record<string, unknown>) => new AppError({ code: 'auth:insufficient_role', message, details });
