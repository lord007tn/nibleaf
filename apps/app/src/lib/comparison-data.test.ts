import { describe, expect, it } from 'vitest';
import { AS_OF, comparisons, roundups } from './comparison-data';

const serialized = JSON.stringify([...comparisons, ...roundups]);

describe('competitor facts', () => {
  it('uses the current official plan names and billing basis', () => {
    expect(AS_OF).toBe('November 7, 2026');
    expect(serialized).toContain('$65 per site/month + $12 per user/month (billed annually)');
    expect(serialized).toContain('$450/month billed annually');
    expect(serialized).not.toContain('Premium');
  });

  it('keeps ReadMe claims limited to its published plans', () => {
    expect(serialized).toContain('1 project, unlimited versions');
    expect(serialized).not.toContain('Unlimited projects');
    expect(serialized).not.toContain('on-premise');
    expect(serialized).toContain('Ask AI Lite is included on Pro/Enterprise');
    expect(serialized).toContain('https://docs.readme.com/main/docs/ask-ai');
  });

  it('describes vendor capabilities without stale feature gaps', () => {
    expect(serialized).toContain('Analytics on Pro/Enterprise');
    expect(serialized).toContain('Enterprise static export by request');
    expect(serialized).toContain('Bitbucket Cloud and multi-repository projects are Enterprise-only');
    expect(serialized).toContain('Self-hosting is listed on Enterprise only');
    expect(serialized).not.toContain('not recommended or supported');
  });

  it('states current Nibleaf capabilities with rollout and infrastructure boundaries', () => {
    expect(serialized).not.toMatch(/v0\.2|read-only MCP|no tracker|instant publishing/i);
    expect(serialized).toContain('in the open-source code now, arriving in the next self-hosted release and on Nibleaf Cloud as it rolls out.');
    expect(serialized).toContain('workspace or instance AI provider key');
    expect(serialized).toContain('optional Qdrant when self-hosting');
    expect(serialized).toContain('optional ClickHouse when self-hosting');
    expect(serialized).toContain('publish only after a confirmed preview');
    expect(serialized).toContain('The editor writing assistant uses the instance key.');
  });
});
