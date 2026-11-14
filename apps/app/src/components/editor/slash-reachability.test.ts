import type { Locale } from '@nibleaf/i18n';
import { describe, expect, it } from 'vitest';
import main from './__fixtures__/slash-reachability-main.json';
import { createSlashItems, rankSlashItems } from './extensions/slash-command';

/*
 * Nothing the slash menu found on main is lost: every block a query reached on
 * main is still among that query's results, in all 12 interface languages.
 *
 * `__fixtures__/slash-reachability-main.json` was made by running main's own
 * slash matcher (main 78d54279) over, for each block and language, the block's
 * title and each of its prefixes, each prefix of its internal name, and each
 * prefix of main's keywords, keeping the 18,689 pairs main reached. Main's
 * matcher also searched descriptions and the middle of words; this PR searches
 * titles, keywords and names from the start of each word only, on purpose.
 */

type Fixture = { locales: Locale[]; pairs: number; items: Record<string, Record<string, string[]>> };
const fixture = main as Fixture;
const items = createSlashItems();
const nameOf = (titleKey: string) => titleKey.split('.')[2] ?? '';

describe('slash reachability against main', () => {
  it('covers every block in every language', () => {
    expect(Object.keys(fixture.items).sort()).toEqual(items.map((item) => nameOf(item.titleKey)).sort());
    expect(fixture.locales).toHaveLength(12);
    const total = Object.values(fixture.items).reduce(
      (sum, entry) => sum + fixture.locales.reduce((count, locale) => count + (entry['*']?.length ?? 0) + (entry[locale]?.length ?? 0), 0),
      0,
    );
    expect(total).toBe(fixture.pairs);
  });

  it('still reaches every block each query reached on main', () => {
    const results = new Map<string, Set<string>>();
    const reached = (query: string, locale: Locale) => {
      const key = `${locale}\u0000${query}`;
      let found = results.get(key);
      if (!found) {
        found = new Set(rankSlashItems(items, query, locale).map((item) => nameOf(item.titleKey)));
        results.set(key, found);
      }
      return found;
    };
    const lost: string[] = [];
    for (const [name, entry] of Object.entries(fixture.items))
      for (const locale of fixture.locales)
        for (const query of [...(entry['*'] ?? []), ...(entry[locale] ?? [])])
          if (!reached(query, locale).has(name)) lost.push(`${locale} "${query}" → ${name}`);
    expect(lost).toEqual([]);
  }, 120_000);

  it('offers Note for "/warning" and "/info", below the exact Warning and Info', () => {
    for (const [query, exact] of [
      ['warning', 'warning'],
      ['info', 'info'],
    ] as const) {
      const names = rankSlashItems(items, query).map((item) => nameOf(item.titleKey));
      expect(names[0]).toBe(exact);
      expect(names).toContain('note');
    }
  });
});
