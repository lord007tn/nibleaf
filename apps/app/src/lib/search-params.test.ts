import { PUBLISH_CHECK_CODES } from '@nibleaf/shared/publish-check-codes';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { iconSize } from '@/components/site/mdx/icon';
import { str } from '@/components/site/mdx/props';
import { Route as SignInRoute } from '@/routes/(auth)/sign-in';
import { Route as SignUpRoute } from '@/routes/(auth)/sign-up';
import { Route as VerifyEmailRoute } from '@/routes/(auth)/verify-email';
import { Route as AiRoute } from '@/routes/app/projects/$projectId/ai';
import { Route as EditorRoute } from '@/routes/app/projects/$projectId/editor';
import { Route as PreviewRoute } from '@/routes/app/projects/$projectId/preview';
import { Route as SiteRoute } from '@/routes/sites/$projectId/route';
import { oneOf, readSearch, trimmedText, withFallback } from './search-params';

// What the router can hand validateSearch: strings, the numbers, booleans,
// arrays and objects its JSON-ish parser makes, and edge lengths.
const values: unknown[] = [
  undefined,
  null,
  '',
  ' ',
  'a',
  ' a ',
  'ab',
  '  ab  ',
  'x'.repeat(35),
  ` ${'x'.repeat(35)} `,
  'x'.repeat(36),
  'x'.repeat(120),
  'x'.repeat(121),
  'x'.repeat(256),
  'x'.repeat(257),
  'x'.repeat(500),
  'x'.repeat(501),
  'true',
  '1',
  'false',
  true,
  false,
  0,
  1,
  123,
  [],
  ['a'],
  {},
  'overview',
  'gaps',
  '7d',
  '24h',
  'up',
  'down',
  'unrated',
  'answered',
  'no_answer',
  'sent',
  'failed',
  'first-publish',
  PUBLISH_CHECK_CODES[0],
  // #836: numbers a parser can make that aren't plain, objects without Object's prototype, and prototype names.
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  -0,
  Object.create(null),
  { __proto__: null, a: 'b' },
  '__proto__',
  'constructor',
  'toString',
];
const flagSchema = z.preprocess((value) => (value === true || value === 'true' || value === '1' ? true : undefined), z.literal(true).optional());

/** Every search a field can meet: the key missing, and the key set to each value. */
const searches = (keys: string[]) => [{}, ...keys.flatMap((key) => values.map((value) => ({ [key]: value })))];

// The schemas the eager routes used before (PUB-017). Each route's own validateSearch is checked against its
// schema (#836), so a field map changed in a route and not here, or the other way round, fails.
const routes = {
  'sites/$projectId': {
    zod: z.object({ lang: z.string().min(1).optional().catch(undefined), ask: z.string().trim().min(2).max(500).optional().catch(undefined) }),
    validate: SiteRoute.options.validateSearch,
  },
  '(auth)/sign-in': {
    zod: z.object({
      invite: z.string().optional().catch(undefined),
      next: z.string().optional().catch(undefined),
      email: z.string().optional().catch(undefined),
      oauth_request: z.string().optional().catch(undefined),
    }),
    validate: SignInRoute.options.validateSearch,
  },
  '(auth)/sign-up': {
    zod: z.object({
      invite: z.string().optional().catch(undefined),
      next: z.string().optional().catch(undefined),
      email: z.string().optional().catch(undefined),
      intent: z.literal('first-publish').optional().catch(undefined),
    }),
    validate: SignUpRoute.options.validateSearch,
  },
  '(auth)/verify-email': {
    zod: z.object({
      email: z.string().optional().catch(undefined),
      token: z.string().optional().catch(undefined),
      invite: z.string().optional().catch(undefined),
      next: z.string().optional().catch(undefined),
      delivery: z.enum(['sent', 'failed']).optional().catch(undefined),
    }),
    validate: VerifyEmailRoute.options.validateSearch,
  },
  'app/projects/$projectId/editor': {
    zod: z.object({
      firstPublish: flagSchema,
      page: z.string().min(1).optional().catch(undefined),
      fix: z.enum(PUBLISH_CHECK_CODES).optional().catch(undefined),
      fixTarget: z.string().min(1).optional().catch(undefined),
      publish: flagSchema,
    }),
    validate: EditorRoute.options.validateSearch,
  },
  'app/projects/$projectId/preview': {
    zod: z.object({
      branchId: z.string().min(1).optional().catch(undefined),
      languageId: z.string().min(1).optional().catch(undefined),
      pageId: z.string().min(1).optional().catch(undefined),
    }),
    validate: PreviewRoute.options.validateSearch,
  },
  'app/projects/$projectId/ai': {
    zod: z.object({
      tab: z.enum(['overview', 'conversations', 'gaps']).catch('overview'),
      range: z.enum(['7d', '30d', '90d']).catch('30d'),
      language: z.string().trim().min(2).max(35).optional().catch(undefined),
      rating: z.enum(['up', 'down', 'unrated']).optional().catch(undefined),
      status: z.enum(['answered', 'no_answer', 'failed']).optional().catch(undefined),
      q: z.string().trim().min(1).max(120).optional().catch(undefined),
      conversation: z.string().min(1).max(256).optional().catch(undefined),
    }),
    validate: AiRoute.options.validateSearch,
  },
};

describe('search-param readers', () => {
  it.each(Object.entries(routes))('read %s exactly as its zod schema did, keys and their order included', (_route, route) => {
    const keys = Object.keys(route.zod.shape);
    const parse = route.validate as (search: Record<string, unknown>) => Record<string, unknown>;
    const withUnknownKey = { unknown: 'dropped', ...Object.fromEntries(keys.slice(0, 1).map((key) => [key, 'ab'])) };
    // Prototype names as keys of the search itself (a parsed `?__proto__=x` makes an own key), a search without
    // Object's prototype, and the keys in reverse order.
    const prototypeKeys = JSON.parse('{"__proto__":"x","constructor":"x","toString":"x","hasOwnProperty":"x"}') as Record<string, unknown>;
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, Object.fromEntries(keys.map((key) => [key, 'ab'])));
    const reversed = Object.fromEntries(keys.toReversed().map((key) => [key, 'ab']));
    const extra = [Object.fromEntries(keys.map((key) => [key, 'x'])), withUnknownKey, prototypeKeys, nullPrototype, reversed];
    for (const search of [...searches(keys), ...extra]) {
      const expected = route.zod.parse(search);
      const actual = parse(search);
      // toStrictEqual tells a missing key from one set to undefined, but not the keys' order.
      expect(actual).toStrictEqual(expected);
      expect(Object.keys(actual)).toEqual(Object.keys(expected));
    }
  });

  it('gives a fallback field its fallback when the param is missing or unreadable', () => {
    const read = { tab: withFallback(oneOf(['a', 'b']), 'a'), q: trimmedText(1, 3) };
    expect(readSearch({}, read)).toStrictEqual({ tab: 'a' });
    expect(readSearch({ tab: 'c', q: ' xy ' }, read)).toStrictEqual({ tab: 'a', q: 'xy' });
    expect(readSearch({ tab: 'b', q: undefined }, read)).toStrictEqual({ tab: 'b', q: undefined });
  });

  it('reads MDX string props and icon sizes as zod did', () => {
    const optionalString = z.string().optional().catch(undefined);
    for (const value of values) expect(str(value)).toBe(optionalString.parse(value));
    const size = z.coerce.number().min(1).max(128);
    for (const value of [
      undefined,
      '',
      '0',
      '1',
      '24',
      '24px',
      '1e2',
      '.5',
      '0.5',
      '12.5',
      '12.5.',
      '128',
      '129',
      '1.2.3',
      'abc',
      'Infinity',
      24,
      0,
      200,
    ]) {
      const parsed = size.safeParse(String(value ?? '').replace(/[^0-9.]/g, ''));
      expect(iconSize(value)).toBe(parsed.success ? parsed.data : undefined);
    }
  });
});
