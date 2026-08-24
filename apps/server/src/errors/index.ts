import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'http:bad_request'
  | 'http:unauthorized'
  | 'http:forbidden'
  | 'http:not_found'
  | 'http:conflict'
  | 'http:unprocessable'
  | 'http:rate_limited'
  | 'http:internal'
  | 'auth:no_user'
  | 'auth:invalid_session'
  | 'auth:invalid_api_key'
  | 'auth:insufficient_role'
  | 'auth:insufficient_scope'
  | 'validation:failed'
  | 'database:not_found'
  | 'database:conflict'
  | 'storage:error'
  | 'search:unavailable'
  | 'ai:provider_response'
  | 'import:invalid_document'
  | 'import:not_found'
  | 'import:unsupported'
  | 'provider:unavailable'
  | 'usage:invalid_period'
  | 'usage:unavailable'
  | 'usage:export_not_ready'
  | 'entitlement:unknown'
  | 'entitlement:disabled'
  | 'addon:not_found'
  | 'addon:unavailable'
  | 'addon:configuration_required'
  | 'addon:revision_conflict'
  | 'integration:not_found'
  | 'integration:provider_unsupported'
  | 'integration:already_connected'
  | 'integration:invalid_configuration'
  | 'integration:credentials_required'
  | 'integration:credentials_invalid'
  | 'integration:inactive'
  | 'integration:verification_failed'
  | 'integration:provider_unavailable'
  | 'integration:rate_limited'
  | 'integration:idempotency_conflict'
  | 'integration:revision_conflict'
  | 'integration:external_confirmation_required'
  | 'integration:confirmation_invalid'
  | 'integration:confirmation_expired'
  | 'integration:confirmation_consumed'
  | 'integration:oauth_state_invalid'
  | 'integration:webhook_signature_invalid'
  | 'integration:webhook_replay';

const ERROR_STATUS = {
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
  'auth:insufficient_scope': 403,
  'validation:failed': 422,
  'database:not_found': 404,
  'database:conflict': 409,
  'storage:error': 502,
  'search:unavailable': 503,
  'ai:provider_response': 502,
  'import:invalid_document': 422,
  'import:not_found': 404,
  'import:unsupported': 422,
  'provider:unavailable': 502,
  'usage:invalid_period': 400,
  'usage:unavailable': 503,
  'usage:export_not_ready': 409,
  'entitlement:unknown': 503,
  'entitlement:disabled': 403,
  'addon:not_found': 404,
  'addon:unavailable': 403,
  'addon:configuration_required': 422,
  'addon:revision_conflict': 409,
  'integration:not_found': 404,
  'integration:provider_unsupported': 422,
  'integration:already_connected': 409,
  'integration:invalid_configuration': 422,
  'integration:credentials_required': 422,
  'integration:credentials_invalid': 422,
  'integration:inactive': 409,
  'integration:verification_failed': 502,
  'integration:provider_unavailable': 502,
  'integration:rate_limited': 429,
  'integration:idempotency_conflict': 409,
  'integration:revision_conflict': 409,
  'integration:external_confirmation_required': 409,
  'integration:confirmation_invalid': 409,
  'integration:confirmation_expired': 409,
  'integration:confirmation_consumed': 409,
  'integration:oauth_state_invalid': 400,
  'integration:webhook_signature_invalid': 401,
  'integration:webhook_replay': 409,
} as const satisfies Record<ErrorCode, ContentfulStatusCode>;

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
    this.status = ERROR_STATUS[options.code];
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

export class ImportError extends AppError {
  constructor(options: Omit<AppErrorOptions, 'code'> & { code: 'import:invalid_document' | 'import:not_found' | 'import:unsupported' }) {
    super(options);
    this.name = 'ImportError';
  }
}
