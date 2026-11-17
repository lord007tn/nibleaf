import { editor_pagetoolarge } from '@nibleaf/i18n/messages/editor_pagetoolarge';
import { MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AppError } from '@/errors';

const MiB = 1024 * 1024;

/** Request bodies without an override below: comfortably above any ordinary
 *  JSON form or settings save. */
export const DEFAULT_REQUEST_BODY_BYTES = 2 * MiB;

/** Page create and update carry one page body as a JSON string. JSON escaping
 *  can grow text up to 6× (control characters become `\uXXXX`), and a page
 *  saved before the size cap may still be over it while being shrunk, so the
 *  request limit sits well above MAX_PAGE_CONTENT_BYTES: a 2.5 MiB body fits
 *  even fully escaped. The page rule itself is applied after parsing. */
export const MAX_PAGE_REQUEST_BYTES = 16 * MiB;

type Limit = { maxBytes: number; error: () => AppError } | 'route';

const tooLarge = (maxBytes: number) => () =>
  new AppError({ code: 'http:payload_too_large', message: `The request body is larger than ${maxBytes / MiB} MiB.`, details: { limit: maxBytes } });

const pageTooLarge = () =>
  new AppError({
    code: 'page:too_large',
    message: editor_pagetoolarge(undefined, { locale: 'en' }),
    details: { limit: MAX_PAGE_CONTENT_BYTES, requestLimit: MAX_PAGE_REQUEST_BYTES },
  });

const project = '/api/app/projects/[^/]+';

/** Routes whose bodies may be larger than the default. `'route'`: the route
 *  sets its own streaming limit (with its own message), so none is added here. */
const OVERRIDES: ReadonlyArray<{ methods: readonly string[]; path: RegExp; limit: Limit }> = [
  { methods: ['POST'], path: new RegExp(`^${project}/pages/?$`), limit: { maxBytes: MAX_PAGE_REQUEST_BYTES, error: pageTooLarge } },
  { methods: ['PATCH'], path: new RegExp(`^${project}/pages/[^/]+/?$`), limit: { maxBytes: MAX_PAGE_REQUEST_BYTES, error: pageTooLarge } },
  // The AI assistant receives the open page's body.
  { methods: ['POST'], path: new RegExp(`^${project}/ai/?$`), limit: { maxBytes: MAX_PAGE_REQUEST_BYTES, error: tooLarge(MAX_PAGE_REQUEST_BYTES) } },
  // A custom Git conflict resolution is one file of up to 2,000,000 characters.
  {
    methods: ['POST'],
    path: new RegExp(`^${project}/git/conflicts/[^/]+/resolve/?$`),
    limit: { maxBytes: MAX_PAGE_REQUEST_BYTES, error: tooLarge(MAX_PAGE_REQUEST_BYTES) },
  },
  // An uploaded OpenAPI document is up to 5,000,000 characters.
  { methods: ['PUT'], path: new RegExp(`^${project}/openapi/?$`), limit: { maxBytes: 32 * MiB, error: tooLarge(32 * MiB) } },
  // GitHub sends webhook payloads of up to 25 MB.
  { methods: ['POST'], path: /^\/api\/public\/git\/webhook\/[^/]+\/?$/, limit: { maxBytes: 25 * MiB, error: tooLarge(25 * MiB) } },
  { methods: ['PUT'], path: new RegExp(`^${project}/assets/upload/[^/]+/?$`), limit: 'route' },
  { methods: ['POST'], path: new RegExp(`^${project}/settings/import/ghost/?$`), limit: 'route' },
];

const DEFAULT_LIMIT: Limit = { maxBytes: DEFAULT_REQUEST_BODY_BYTES, error: tooLarge(DEFAULT_REQUEST_BODY_BYTES) };

const requestBodyLimitFor = (method: string, path: string): Limit =>
  OVERRIDES.find((rule) => rule.methods.includes(method) && rule.path.test(path))?.limit ?? DEFAULT_LIMIT;

/** Every request body is limited before anything parses it. The limit is
 *  streaming: a declared Content-Length over it is refused without reading,
 *  and an undeclared body is cut off as soon as it passes the limit. Answers
 *  413 (`page:too_large` on page saves, `http:payload_too_large` elsewhere). */
export const requestBodyLimit = (): MiddlewareHandler => async (ctx, next) => {
  if (ctx.req.method === 'GET' || ctx.req.method === 'HEAD' || ctx.req.method === 'OPTIONS') return next();
  const limit = requestBodyLimitFor(ctx.req.method, ctx.req.path);
  if (limit === 'route') return next();
  return bodyLimit({
    maxSize: limit.maxBytes,
    onError: () => {
      throw limit.error();
    },
  })(ctx, next);
};
