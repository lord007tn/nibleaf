/*
 * Search-param readers for route `validateSearch` options. Those options can't be
 * split from a route, so they ship in the router's eager chunk, which every page
 * loads, published docs included. Zod there cost every reader page ~23 KiB gzip
 * (PUB-017), so the eager routes read their params with these instead.
 *
 * They keep the zod schemas' results exactly, down to which keys appear: an
 * optional param is in the result only when it is in the search (`undefined`
 * when it doesn't read), and a param with a fallback is always there. See
 * search-params.test.ts, which checks them against those schemas.
 */

/** Reads one param: its value, or `undefined` when it doesn't read. */
export type SearchField<T> = (value: unknown) => T | undefined;
/** A field that is always in the result, with `fallback` when it doesn't read. */
export type FallbackField<T> = ((value: unknown) => T) & { readonly fallback: T };

/** A string, as given (zod: `z.string().optional().catch(undefined)`). */
export const text: SearchField<string> = (value) => (typeof value === 'string' ? value : undefined);

/** A string of `min` to `max` characters, as given (zod: `z.string().min().max()`). */
export const boundedText =
  (min: number, max = Number.POSITIVE_INFINITY): SearchField<string> =>
  (value) =>
    typeof value === 'string' && value.length >= min && value.length <= max ? value : undefined;

/** A string trimmed, then `min` to `max` characters (zod: `z.string().trim().min().max()`). */
export const trimmedText =
  (min: number, max: number): SearchField<string> =>
  (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    return trimmed.length >= min && trimmed.length <= max ? trimmed : undefined;
  };

/** One of `values` (zod: `z.enum()` or `z.literal()`). */
export const oneOf =
  <const T extends string>(values: readonly T[]): SearchField<T> =>
  (value) =>
    (values as readonly unknown[]).includes(value) ? (value as T) : undefined;

/** `true` for `true`, `'true'` or `'1'`; nothing else reads. */
export const flag: SearchField<true> = (value) => (value === true || value === 'true' || value === '1' ? true : undefined);

/** `field`, or `fallback` when it doesn't read (zod: `.catch(fallback)`). */
export const withFallback = <T>(field: SearchField<T>, fallback: T): FallbackField<T> =>
  Object.assign((value: unknown) => field(value) ?? fallback, { fallback });

type Fields = Record<string, SearchField<unknown> | FallbackField<unknown>>;
type Value<F> = F extends (value: unknown) => infer T ? Exclude<T, undefined> : never;
type FallbackKeys<S extends Fields> = { [K in keyof S]: S[K] extends FallbackField<unknown> ? K : never }[keyof S];
export type SearchOf<S extends Fields> = { [K in FallbackKeys<S>]: Value<S[K]> } & {
  [K in Exclude<keyof S, FallbackKeys<S>>]?: Value<S[K]> | undefined;
};

/** The params `fields` name, read from a route's raw search; the rest are dropped. */
export const readSearch = <S extends Fields>(search: Record<string, unknown>, fields: S): SearchOf<S> => {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if ('fallback' in field || key in search) result[key] = field(search[key]);
  }
  return result as SearchOf<S>;
};
