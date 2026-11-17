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

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The longest whole-grapheme prefix within `max` code points. */
const firstGraphemes = (value: string, max: number): string => {
  // Each code point takes at least one UTF-16 unit, so a short string fits as is.
  if (value.length <= max) return value;
  let out = '';
  let count = 0;
  for (const { segment } of graphemes.segment(value)) {
    const size = codePointLength(segment);
    if (count + size > max) break;
    out += segment;
    count += size;
  }
  return out;
};

/** Fit whole graphemes within the API's code-point budget. */
export const truncateSearchQuery = (value: string): string => firstGraphemes(value, SEARCH_QUERY_MAX_LENGTH);

/** Whether `value` is longer than the API accepts, in code points. */
export const exceedsSearchQueryLimit = (value: string): boolean =>
  value.length > SEARCH_QUERY_MAX_LENGTH && codePointLength(value) > SEARCH_QUERY_MAX_LENGTH;

const graphemeBoundary = (value: string, at: number): number => (at === value.length ? at : (graphemes.segment(value).containing(at)?.index ?? 0));

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
  const position = Math.min(Math.max(caret ?? next.length, 0), next.length);
  // A combining mark or ZWJ can join text on either side of the edit. Include
  // that entire grapheme before deciding what fits.
  const containing = graphemes.segment(next).containing(position);
  const end = containing && containing.index < position ? containing.index + containing.segment.length : position;
  const tail = next.slice(end);
  if (tail.length <= previous.length && previous.endsWith(tail)) {
    // The edit replaced previous[start, previous.length - tail.length) with next[start, end).
    const limit = Math.min(end, previous.length - tail.length);
    let start = 0;
    while (start < limit && next.charCodeAt(start) === previous.charCodeAt(start)) start++;
    const commonStart = start;
    while (true) {
      const boundary = Math.min(graphemeBoundary(next, start), graphemeBoundary(previous, start));
      if (boundary === start) break;
      start = boundary;
    }
    const prefix = next.slice(0, start);
    const room = SEARCH_QUERY_MAX_LENGTH - codePointLength(prefix) - codePointLength(tail);
    if (room >= 0) {
      const kept = firstGraphemes(next.slice(start, end), room);
      // Reject an edit that would take its unchanged base or following marks
      // with it. The previously accepted grapheme stays intact.
      if (((!kept && start < commonStart) || (end > position && kept.length < end - start)) && !exceedsSearchQueryLimit(previous)) {
        return { value: previous, caret: graphemeBoundary(previous, commonStart) };
      }
      const value = prefix + kept + tail;
      return { value, caret: graphemeBoundary(value, start + kept.length) };
    }
  }
  const value = truncateSearchQuery(next);
  return { value, caret: graphemeBoundary(value, Math.min(position, value.length)) };
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
