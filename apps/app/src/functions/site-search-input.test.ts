import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseSearchSiteInput, SearchSiteInputError } from './site-search-input';

// The zod schema `searchSiteFn` used before #836. The plain check replaced it so
// opening search doesn't load zod; it must accept, reject and return exactly
// what this schema does.
const zodSearchSiteInput = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().max(128).optional(),
  consentState: z.enum(['denied', 'granted', 'not_required', 'unknown']).default('unknown'),
  query: z.string().trim().min(1).max(300),
  language: z.string().min(1).max(35).optional(),
  prefer: z.string().min(1).max(35).optional(),
  version: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

type Outcome = { ok: true; value: unknown } | { ok: false };

const viaZod = (input: unknown): Outcome => {
  const result = zodSearchSiteInput.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false };
};

const viaPlain = (input: unknown): Outcome => {
  try {
    return { ok: true, value: parseSearchSiteInput(input) };
  } catch (error) {
    expect(error).toBeInstanceOf(SearchSiteInputError);
    return { ok: false };
  }
};

const describeInput = (input: unknown) => {
  try {
    return JSON.stringify(input, (_key, value) => (typeof value === 'number' && !Number.isFinite(value) ? String(value) : value));
  } catch {
    return String(input);
  }
};

/** Same verdict, and on success the same object: toStrictEqual tells a missing key from one set to undefined. */
const expectParity = (input: unknown) => {
  const expected = viaZod(input);
  const actual = viaPlain(input);
  expect(actual.ok, `verdict for ${describeInput(input)}`).toBe(expected.ok);
  if (expected.ok && actual.ok) expect(actual.value, `result for ${describeInput(input)}`).toStrictEqual(expected.value);
  return expected.ok;
};

const FIELDS = ['projectId', 'sessionId', 'consentState', 'query', 'language', 'prefer', 'version', 'limit'] as const;

const EMOJI = '\u{1F600}';
const HIGH = '\uD83D';
const LOW = '\uDE00';

const VALUES: unknown[] = [
  undefined,
  null,
  '',
  ' ',
  '   ',
  '\t\n',
  ' ', // trimmed by String#trim
  '​', // zero-width space: not whitespace, so not trimmed
  'a',
  '  custom domain  ',
  'بحث عن النطاق',
  '  بحث  ',
  'ar',
  'zh-Hant-TW',
  'v2',
  EMOJI,
  EMOJI.repeat(17), // 34 UTF-16 units
  EMOJI.repeat(18), // 36 UTF-16 units but 18 code points: zod measures code points
  EMOJI.repeat(35),
  EMOJI.repeat(36),
  EMOJI.repeat(128),
  EMOJI.repeat(129),
  ` ${EMOJI.repeat(300)} `,
  EMOJI.repeat(301),
  HIGH, // a lone surrogate counts as one code point
  LOW + HIGH, // a reversed pair is two code points
  HIGH.repeat(36),
  `x${EMOJI.repeat(34)}`,
  `${EMOJI.repeat(34)}${HIGH}${HIGH}`,
  'x'.repeat(35),
  'x'.repeat(36),
  'x'.repeat(128),
  'x'.repeat(129),
  'x'.repeat(300),
  'x'.repeat(301),
  ` ${'x'.repeat(300)} `,
  'ب'.repeat(300),
  'ب'.repeat(301),
  'denied',
  'granted',
  'not_required',
  'unknown',
  'GRANTED',
  '__proto__',
  'constructor',
  'toString',
  '8',
  0,
  1,
  1.5,
  8,
  50,
  51,
  -1,
  -0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  2 ** 53,
  true,
  false,
  [],
  ['a'],
  {},
  { toString: () => 'a' },
  Object.create(null),
  new Object('a'), // a boxed String
  new Object(8), // a boxed Number
  10n,
  Symbol('q'),
  () => 'a',
];

const BASE = { projectId: 'docs', query: 'custom domain' };

describe('reader search input without zod', () => {
  it('accepts a full valid input and returns the same object as the zod schema', () => {
    const input = {
      projectId: 'docs',
      sessionId: 's-1',
      consentState: 'granted',
      query: '  custom domain ',
      language: 'en',
      prefer: 'ar',
      version: 'v2',
      limit: 8,
      extra: 'dropped',
    };
    expect(expectParity(input)).toBe(true);
    expect(parseSearchSiteInput(input)).toStrictEqual({
      projectId: 'docs',
      sessionId: 's-1',
      consentState: 'granted',
      query: 'custom domain',
      language: 'en',
      prefer: 'ar',
      version: 'v2',
      limit: 8,
    });
  });

  it('defaults consent and leaves absent optional keys out', () => {
    expect(parseSearchSiteInput(BASE)).toStrictEqual({ projectId: 'docs', query: 'custom domain', consentState: 'unknown' });
    expectParity(BASE);
  });

  it.each(FIELDS)('matches zod for %s missing and set to each edge value', (field) => {
    const { [field]: _omitted, ...rest } = BASE as Record<string, unknown>;
    expectParity(rest);
    let accepted = 0;
    for (const value of VALUES) if (expectParity({ ...BASE, [field]: value })) accepted++;
    // Every field accepts some of these values and rejects others.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(VALUES.length);
  });

  it('matches zod for pairs of edge values across fields', () => {
    const sample = VALUES.filter((_, index) => index % 3 === 0);
    for (const a of FIELDS)
      for (const b of FIELDS) {
        if (a >= b) continue;
        for (const va of sample) for (const vb of sample) expectParity({ ...BASE, [a]: va, [b]: vb });
      }
  });

  it('rejects what is not an object, like zod', () => {
    for (const input of [undefined, null, 'docs', 42, Number.NaN, true, [], [BASE], () => BASE, Symbol('x'), 1n]) {
      expect(expectParity(input)).toBe(false);
    }
  });

  it('treats prototype keys and inherited fields like zod', () => {
    // Inherited fields count, as `key in input` and `input[key]` see them.
    expectParity(Object.create(BASE));
    expectParity(Object.assign(Object.create({ projectId: 'docs' }), { query: 'q', limit: 5 }));
    // A null-prototype object works the same as a plain one.
    expectParity(Object.assign(Object.create(null), BASE, { language: 'ar', limit: 50 }));
    // An own __proto__ key (as JSON.parse makes it) is never read as a field or copied.
    const polluted = JSON.parse('{"projectId":"docs","query":"q","__proto__":{"limit":999,"isAdmin":true}}');
    expect(expectParity(polluted)).toBe(true);
    const result = parseSearchSiteInput(polluted) as unknown as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
    expect(result.limit).toBeUndefined();
    expect(result.isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    // Keys named after Object.prototype members are dropped like any other unknown key.
    expectParity({ ...BASE, constructor: 'x', toString: 'y', hasOwnProperty: 1 });
    // A prototype carrying a bad value makes the input invalid, as in zod.
    expect(expectParity(Object.assign(Object.create({ limit: Number.NaN }), BASE))).toBe(false);
  });

  it('keeps a present-but-undefined optional key as undefined, like zod', () => {
    const input = {
      ...BASE,
      sessionId: undefined,
      language: undefined,
      prefer: undefined,
      version: undefined,
      limit: undefined,
      consentState: undefined,
    };
    expect(expectParity(input)).toBe(true);
    const result = parseSearchSiteInput(input);
    expect(Object.keys(result).sort()).toEqual(['consentState', 'language', 'limit', 'prefer', 'projectId', 'query', 'sessionId', 'version']);
    expect(result.consentState).toBe('unknown');
  });

  it('reads each field once through a getter, as zod does', () => {
    let reads = 0;
    const input = {
      projectId: 'docs',
      get query() {
        reads++;
        return reads === 1 ? ' q ' : 'x'.repeat(400);
      },
    };
    expect(parseSearchSiteInput(input).query).toBe('q');
    expect(reads).toBe(1);
  });
});
