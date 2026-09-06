import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../content/blog/*.mdx', { eager: true, query: '?raw', import: 'default' });
const newGuideNames = [
  'ai-ready-documentation.mdx',
  'coolify-documentation-502-503-recovery.mdx',
  'documentation-information-architecture-collaboration.mdx',
  'documentation-migration-seo-cutover-lab.mdx',
  'documentation-production-readiness-decision.mdx',
];

const sourceFor = (name: string): string => {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(`/${name}`));
  if (!entry) throw new Error(`Missing guide source: ${name}`);
  return entry[1];
};

describe('guide academy long-form content', () => {
  it.each(newGuideNames)('%s is substantial, dated, source-backed, and neutral-first', (name) => {
    const source = sourceFor(name);
    const body = source.replace(/^---[\s\S]*?---/u, '');
    const words = body.split(/\s+/u).filter(Boolean);
    const firstNibleaf = body.indexOf('Nibleaf');

    expect(words.length).toBeGreaterThanOrEqual(1400);
    expect(source).toContain("dateModified: '2026-09-03'");
    expect(body).toContain('References reviewed 2026-09-03');
    expect(firstNibleaf).toBeGreaterThan(body.length * 0.6);
    expect(body).toMatch(/GitBook/u);
    expect(body).toMatch(/Mintlify/u);
    expect(body).toMatch(/Docusaurus/u);
    expect(body).toMatch(/Starlight/u);
    expect(body).toMatch(/Source `main`|source `main`/u);
  });

  it('connects each deterministic fixture to an explanatory guide', () => {
    const combined = Object.values(sources).join('\n');
    for (const fixture of [
      'markdown-round-trip.mdx',
      'migration-url-map.csv',
      'arabic-search-corpus.json',
      'arabic-search-queries.json',
      'resource-sizing-observations.csv',
    ]) {
      expect(combined).toContain(`/guides/fixtures/${fixture}`);
    }
  });
});
