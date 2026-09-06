import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'public/guides/fixtures', name), 'utf8');

describe('guide academy fixtures', () => {
  it('keeps the Arabic relevance judgments referentially complete and deterministic', () => {
    const corpus = JSON.parse(fixture('arabic-search-corpus.json')) as Array<{ id: string; body: string }>;
    const queries = JSON.parse(fixture('arabic-search-queries.json')) as Array<{ query: string; expectedDocumentIds: string[] }>;
    const ids = new Set(corpus.map((document) => document.id));

    expect(corpus).toHaveLength(4);
    expect(queries).toHaveLength(6);
    expect(new Set(corpus.map((document) => document.id)).size).toBe(corpus.length);
    expect(queries.every((query) => query.expectedDocumentIds.length > 0 && query.expectedDocumentIds.every((id) => ids.has(id)))).toBe(true);
    expect(`${fixture('arabic-search-corpus.json')} ${fixture('arabic-search-queries.json')}`).not.toMatch(/@|token|secret|customer/iu);
  });

  it('provides a complete redirect rehearsal contract with no production hosts', () => {
    const rows = fixture('migration-url-map.csv').trim().split(/\r?\n/u);
    expect(rows[0]).toBe('source_path,target_path,expected_status,owner,rollback_trigger');
    expect(rows).toHaveLength(5);
    expect(rows.slice(1).every((row) => row.startsWith('/') && row.includes(',308,'))).toBe(true);
    expect(rows.join('\n')).not.toContain('nibleaf.com');
  });

  it('labels sizing observations as illustrative and exercises rich Markdown round trips', () => {
    const sizing = fixture('resource-sizing-observations.csv');
    const markdown = fixture('markdown-round-trip.mdx');
    expect(sizing.match(/example only/g)).toHaveLength(3);
    expect(markdown).toContain('<Callout title="Round-trip assertion">');
    expect(markdown).toContain('English before العربية بعد English');
    expect(markdown).toContain('```json');
  });
});
