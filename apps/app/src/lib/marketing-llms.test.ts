import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { marketingLlms, marketingLlmsFull, marketingPricingMarkdown } from './marketing-llms';
import { marketingMarkdownSourceUrls } from './marketing-sitemap';

const origin = 'https://nibleaf.example';

describe('machine-readable marketing copy', () => {
  it.each([marketingLlms, marketingLlmsFull, marketingPricingMarkdown])('%s keeps product claims current and qualified', (render) => {
    const text = render(origin);
    expect(text).not.toMatch(/v0\.2|read-only|atomic|public read access only|round-trips? losslessly|queues a new publish/i);
    expect(text).toContain('draft, edit, move, translate, set visibility, and publish only after a confirmed preview');
    expect(text).toContain('Read only / Support writer / Full admin');
    expect(text).toContain('OAuth sign-in or expiring personal keys');
    expect(text).toContain('off by default for self-hosters');
    expect(text).toContain('in the open-source code now, arriving in the next self-hosted release and on Nibleaf Cloud as it rolls out.');
    expect(text).toContain('key from the workspace or instance, per-site opt-in');
    expect(text).toContain('optional Qdrant service');
    expect(text).toContain('optional ClickHouse');
    expect(text).toContain('editor writing assistant separately uses the instance key');
    expect(text).toContain('Rollback creates a new ready deployment from an earlier published snapshot');
    expect(text).toContain('SEARCH_ANSWER_ENABLED=true');
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

  it('links only to product documentation slugs present in the repository', () => {
    const text = [marketingLlms(origin), marketingLlmsFull(origin)].join('\n');
    for (const match of text.matchAll(/https:\/\/docs\.nibleaf\.com\/([^\s)]+)/g)) {
      const path = fileURLToPath(new URL(`../../../../docs/${match[1]}`, import.meta.url));
      expect(existsSync(`${path}.mdx`) || existsSync(`${path}.md`), match[0]).toBe(true);
    }
  });
});
