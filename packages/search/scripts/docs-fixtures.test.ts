import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Fixture } from './build-docs-fixtures';

const fixtures = JSON.parse(await readFile(new URL('../eval/nibleaf-docs-fixtures.json', import.meta.url), 'utf8')) as Fixture[];
describe('dogfood fixture contract', () => {
  it('covers all three languages and the required behavior categories', () => {
    expect(fixtures).toHaveLength(36);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(36);
    for (const language of ['en', 'ar', 'mixed']) expect(fixtures.filter((f) => f.language === language)).toHaveLength(12);
    expect(fixtures.filter((f) => f.history?.length).length).toBeGreaterThanOrEqual(6);
    expect(fixtures.filter((f) => f.expectedNoAnswer).length).toBeGreaterThanOrEqual(6);
    expect(fixtures.filter((f) => f.expectClarifying).length).toBeGreaterThanOrEqual(3);
  });
  it('ships actual bounded sections, distinct distractors and explicit citation targets', async () => {
    for (const fixture of fixtures) {
      expect(fixture.sources.length).toBeGreaterThanOrEqual(3);
      expect(fixture.sources.length).toBeLessThanOrEqual(5);
      expect(new Set(fixture.sources.map((s) => `${s.path}#${s.heading}`)).size).toBe(fixture.sources.length);
      for (const source of fixture.sources) {
        expect(source.content.length).toBeLessThanOrEqual(1800);
        const doc = await readFile(new URL(`../../../docs/${source.path}.mdx`, import.meta.url), 'utf8');
        expect(doc.replace(/\r\n/g, '\n')).toContain(source.content);
        expect(source.content.startsWith(`## ${source.heading}\n`)).toBe(true);
      }
      expect(fixture.expectedSourceHeadings).toEqual(fixture.expectedNoAnswer ? [] : expect.arrayContaining([expect.any(String)]));
      for (const heading of fixture.expectedSourceHeadings ?? []) expect(fixture.sources.some((s) => s.heading === heading)).toBe(true);
    }
  });
});
