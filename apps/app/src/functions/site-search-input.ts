/**
 * Checks the reader search input before it goes to the public API, without zod,
 * so opening search doesn't load zod on a docs page. The API validates the query
 * again on the server (`siteSearchQuery` in apps/server), which stays the
 * authority; this check keeps the client from sending a request the API would
 * reject.
 *
 * It accepts and rejects the same inputs as the zod schema it replaced, and
 * returns the same shape, which `site-search-input.test.ts` checks against
 * that schema:
 *
 *   z.object({
 *     projectId: z.string().min(1),
 *     sessionId: z.string().max(128).optional(),
 *     consentState: z.enum(['denied', 'granted', 'not_required', 'unknown']).default('unknown'),
 *     query: z.string().trim().min(1).max(300),
 *     language: z.string().min(1).max(35).optional(),
 *     prefer: z.string().min(1).max(35).optional(),
 *     version: z.string().min(1).optional(),
 *     limit: z.number().int().min(1).max(50).optional(),
 *   })
 *
 * As in zod, lengths count code points, not UTF-16 units, a key counts as present when `key in input` (inherited keys too),
 * an optional key that is present but `undefined` stays in the result as
 * `undefined`, an absent one stays absent, and unknown keys are dropped.
 */

const CONSENT_STATES = ['denied', 'granted', 'not_required', 'unknown'] as const;
export type SearchConsentState = (typeof CONSENT_STATES)[number];

export interface SearchSiteInput {
  projectId: string;
  sessionId?: string | undefined;
  consentState?: SearchConsentState | undefined;
  query: string;
  language?: string | undefined;
  /** The reader's language: ranked first, while every language is searched. */
  prefer?: string | undefined;
  version?: string | undefined;
  limit?: number | undefined;
}

export interface SearchSiteData {
  projectId: string;
  sessionId?: string | undefined;
  consentState: SearchConsentState;
  query: string;
  language?: string | undefined;
  prefer?: string | undefined;
  version?: string | undefined;
  limit?: number | undefined;
}

export class SearchSiteInputError extends TypeError {
  constructor(readonly field: string) {
    super(`Invalid search input: ${field}`);
    this.name = 'SearchSiteInputError';
  }
}

type Fields = Record<string, unknown>;

/** Length in code points, as zod measures strings: the string iterator yields a
 * surrogate pair once and a lone surrogate as itself. Inputs here are short. */
const codePointLength = (value: string) => {
  let count = 0;
  for (const _codePoint of value) count++;
  return count;
};

const lengthIn = (value: unknown, min: number, max: number): value is string => {
  if (typeof value !== 'string') return false;
  const length = codePointLength(value);
  return length >= min && length <= max;
};

/** An optional string: absent stays absent, present-but-undefined stays undefined. */
const optionalText = (input: Fields, out: Fields, key: string, min: number, max: number) => {
  const value = input[key];
  if (value === undefined) {
    if (key in input) out[key] = undefined;
    return;
  }
  if (!lengthIn(value, min, max)) throw new SearchSiteInputError(key);
  out[key] = value;
};

export function parseSearchSiteInput(input: unknown): SearchSiteData {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new SearchSiteInputError('input');
  const fields = input as Fields;
  const out: Fields = {};

  const projectId = fields.projectId;
  if (!lengthIn(projectId, 1, Number.POSITIVE_INFINITY)) throw new SearchSiteInputError('projectId');
  out.projectId = projectId;

  optionalText(fields, out, 'sessionId', 0, 128);

  const consentState = fields.consentState;
  if (consentState === undefined) out.consentState = 'unknown';
  else if (typeof consentState === 'string' && (CONSENT_STATES as readonly string[]).includes(consentState)) out.consentState = consentState;
  else throw new SearchSiteInputError('consentState');

  const query = fields.query;
  if (typeof query !== 'string') throw new SearchSiteInputError('query');
  const trimmed = query.trim();
  if (!lengthIn(trimmed, 1, 300)) throw new SearchSiteInputError('query');
  out.query = trimmed;

  optionalText(fields, out, 'language', 1, 35);
  optionalText(fields, out, 'prefer', 1, 35);
  optionalText(fields, out, 'version', 1, Number.POSITIVE_INFINITY);

  const limit = fields.limit;
  if (limit === undefined) {
    if ('limit' in fields) out.limit = undefined;
  } else if (typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 50) out.limit = limit;
  else throw new SearchSiteInputError('limit');

  return out as unknown as SearchSiteData;
}
