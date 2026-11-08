import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { marketingLlms, marketingLlmsFull, marketingPricingMarkdown } from './marketing-llms';
import { marketingMarkdownSourceUrls } from './marketing-sitemap';

const origin = 'https://nibleaf.example';

describe('machine-readable marketing copy', () => {
  it.each([marketingLlms, marketingLlmsFull, marketingPricingMarkdown])('%s keeps product claims current and qualified', (render) => {
    const text = render(origin);
    expect(text).not.toMatch(
      /v0\.2\.0|next self-hosted release|read-only|atomic|public read access only|round-trips? losslessly|queues a new publish/i,
    );
    expect(text).toContain('draft, edit, move, translate, set visibility, and publish only after a confirmed preview');
    expect(text).toContain('Read only / Support writer / Full admin');
    expect(text).toContain('OAuth sign-in or expiring personal keys');
    expect(text).toContain('off by default for self-hosters');
    expect(text).toContain('are available in self-hosted v0.2.1, and on Nibleaf Cloud as it rolls out.');
    expect(text).toContain('key from the workspace or instance, per-site opt-in');
    expect(text).toContain('optional Qdrant service');
    expect(text).toContain('optional ClickHouse');
    expect(text).toContain('editor writing assistant separately uses the instance key');
    expect(text).toContain('Rollback creates a new ready deployment from an earlier published snapshot');
    expect(text).toContain('SEARCH_ANSWER_ENABLED=true');
    expect(text).toContain('A guided dashboard home with a start-here checklist is available in self-hosted v0.2.1');
    expect(text).toContain('No paid cloud plan is offered today');
    expect(text).toContain('no card at sign-up');
  });

  it('retains the complete generated public Markdown inventory and correct root alias', () => {
    const full = marketingLlmsFull(origin);
    expect(full).toContain('## Public Markdown source inventory');
    for (const url of marketingMarkdownSourceUrls(origin)) expect(full).toContain(`- ${url}\n`);
    expect(marketingLlms(origin)).toContain(`${origin}/_index.md`);
    expect(marketingLlms(origin)).not.toContain(`${origin}/index.md`);
  });

  it('lists the comparison, alternatives and company pages, each with a Markdown alias in the inventory', () => {
    const text = marketingLlms(origin);
    const inventory = new Set(marketingMarkdownSourceUrls(origin));
    const aliases = [...text.matchAll(/\]\((https:\/\/nibleaf\.example\/[^)]+\.md)\)/g)].flatMap((match) => (match[1] ? [match[1]] : []));
    expect(aliases.length).toBeGreaterThanOrEqual(20);
    for (const alias of aliases) expect(inventory.has(alias), alias).toBe(true);
    for (const path of ['/compare/nibleaf-vs-mintlify.md', '/alternatives/readme.md', '/cloud.md', '/blog.md']) {
      expect(text).toContain(`${origin}${path}`);
    }
    expect(text).toContain(`${origin}/.well-known/security.txt`);
  });

  it('links only to product documentation slugs present in the repository', () => {
    const text = [marketingLlms(origin), marketingLlmsFull(origin)].join('\n');
    for (const match of text.matchAll(/https:\/\/docs\.nibleaf\.com\/([^\s)]+)/g)) {
      const path = fileURLToPath(new URL(`../../../../docs/${match[1]}`, import.meta.url));
      expect(existsSync(`${path}.mdx`) || existsSync(`${path}.md`), match[0]).toBe(true);
    }
  });
});
