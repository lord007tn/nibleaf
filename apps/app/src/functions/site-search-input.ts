/**
 * Checks the reader search input before it goes to the public API, without zod,
 * so opening search doesn't load zod on a docs page. The API validates the query
 * again on the server (`siteSearchQuery` in apps/server), which stays the
 * authority; this check keeps the client from sending a request the API would
 * reject.
 *
 * It accepts and rejects the same inputs as this zod schema, and returns the
 * same shape, which `site-search-input.test.ts` checks against that schema.
 * The query's limit is the API's (`SEARCH_QUERY_MAX_LENGTH`, 200), not the 300
 * the replaced schema allowed, so the browser never sends a query the API
 * refuses with a 422:
 *
 *   z.object({
 *     projectId: z.string().min(1),
 *     sessionId: z.string().max(128).optional(),
 *     consentState: z.enum(['denied', 'granted', 'not_required', 'unknown']).default('unknown'),
 *     query: z.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH),
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

import { SEARCH_QUERY_MAX_LENGTH } from '@nibleaf/validators/search';

export { SEARCH_QUERY_MAX_LENGTH };

const CONSENT_STATES = ['denied', 'granted', 'not_required', 'unknown'] as const;
type SearchConsentState = (typeof CONSENT_STATES)[number];

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

interface SearchSiteData {
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

/** The first `max` code points of `value`. */
const firstCodePoints = (value: string, max: number): string => {
  // Each code point takes at least one UTF-16 unit, so a short string fits as is.
  if (value.length <= max) return value;
  let out = '';
  let count = 0;
  for (const codePoint of value) {
    if (count === max) break;
    out += codePoint;
    count++;
  }
  return out;
};

/** The first `SEARCH_QUERY_MAX_LENGTH` code points of `value`. A longer query is
 * cut, never rejected, so search shows results for what fits; the cut falls
 * between code points, so it never splits a surrogate pair. */
export const truncateSearchQuery = (value: string): string => firstCodePoints(value, SEARCH_QUERY_MAX_LENGTH);

/** Whether `value` is longer than the API accepts, in code points. */
export const exceedsSearchQueryLimit = (value: string): boolean =>
  value.length > SEARCH_QUERY_MAX_LENGTH && codePointLength(value) > SEARCH_QUERY_MAX_LENGTH;

const isHighSurrogate = (unit: number) => unit >= 0xd8_00 && unit <= 0xdb_ff;
const isLowSurrogate = (unit: number) => unit >= 0xdc_00 && unit <= 0xdf_ff;
/** `at`, moved back one unit if it falls between the halves of a surrogate pair. */
const codePointBoundary = (value: string, at: number) =>
  at > 0 && at < value.length && isHighSurrogate(value.charCodeAt(at - 1)) && isLowSurrogate(value.charCodeAt(at)) ? at - 1 : at;

/**
 * Fits an edit of the search field into the API's limit the way `maxLength`
 * does, but counting code points: of the text just typed or pasted, only what
 * fits is kept, the text around it stays, and the caret lands at the end of the
 * kept text. `previous` is the field's value before the edit, `next` the
 * over-long value after it, and `caret` the caret after it (`selectionEnd`), in
 * UTF-16 units. When the edit can't be told apart from the text around it, the
 * value loses its end instead and the caret stays put, clamped to the new value.
 */
export function capSearchQueryEdit(previous: string, next: string, caret: number | null): { value: string; caret: number } {
  const end = Math.min(Math.max(caret ?? next.length, 0), next.length);
  const tail = next.slice(end);
  if (tail.length <= previous.length && previous.endsWith(tail)) {
    // The edit replaced previous[start, previous.length - tail.length) with next[start, end).
    const limit = Math.min(end, previous.length - tail.length);
    let start = 0;
    while (start < limit && next.charCodeAt(start) === previous.charCodeAt(start)) start++;
    start = codePointBoundary(next, start);
    const prefix = next.slice(0, start);
    const room = SEARCH_QUERY_MAX_LENGTH - codePointLength(prefix) - codePointLength(tail);
    if (room >= 0) {
      const kept = firstCodePoints(next.slice(start, end), room);
      return { value: prefix + kept + tail, caret: start + kept.length };
    }
  }
  const value = truncateSearchQuery(next);
  return { value, caret: codePointBoundary(value, Math.min(end, value.length)) };
}

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
  if (!lengthIn(trimmed, 1, SEARCH_QUERY_MAX_LENGTH)) throw new SearchSiteInputError('query');
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
