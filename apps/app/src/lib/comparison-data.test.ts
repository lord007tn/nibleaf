import { 'marketing.release.searchPublishing' as searchPublishing } from '@nibleaf/i18n/messages';
import { describe, expect, it } from 'vitest';
import { comparisons, roundups } from './comparison-data';
import { marketingFaqs } from './marketing-faqs';

const serialized = JSON.stringify([...comparisons, ...roundups]);

describe('competitor facts', () => {
  it('keeps ReadMe claims limited to its published plans', () => {
    expect(serialized).toContain('1 project, unlimited versions');
    expect(serialized).not.toContain('Unlimited projects');
    expect(serialized).not.toContain('on-premise');
    expect(serialized).toContain('Ask AI Lite is included on Pro/Enterprise');
    expect(serialized).toContain('https://docs.readme.com/main/docs/ask-ai');
  });

  it('states current Nibleaf capabilities with rollout and infrastructure boundaries', () => {
    expect(serialized).not.toMatch(/v0\.2\.0|next self-hosted release|read-only MCP|no tracker|instant publishing/i);
    expect(serialized).toContain('are available on Nibleaf Cloud and in self-hosted v0.2.1.');
    expect(serialized).toContain('workspace or instance AI provider key');
    expect(serialized).toContain('the Qdrant service when self-hosting');
    expect(serialized).toContain('optional ClickHouse when self-hosting');
    expect(serialized).toContain('publish only after a confirmed preview');
    expect(serialized).toContain('The editor writing assistant uses the instance key.');
  });

  it('keeps features newer than the latest self-hosted release out of shared copy as shipped', () => {
    expect(JSON.stringify(marketingFaqs)).not.toMatch(/optional Qdrant/);
    expect(serialized).not.toMatch(/hashed identities|New insights are|analytics with consent/);
    for (const locale of ['en', 'ar'] as const) {
      expect(searchPublishing({}, { locale })).not.toMatch(/section links|روابط للأقسام/);
    }
  });
});
