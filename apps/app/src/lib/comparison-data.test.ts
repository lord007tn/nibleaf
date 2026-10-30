import { describe, expect, it } from 'vitest';
import { AS_OF, comparisons, roundups } from './comparison-data';

const serialized = JSON.stringify([...comparisons, ...roundups]);

describe('competitor facts', () => {
  it('uses the current official plan names and billing basis', () => {
    expect(AS_OF).toBe('October 30, 2026');
    expect(serialized).toContain('$65 per site/month + $12 per user/month (billed annually)');
    expect(serialized).toContain('$450/month billed annually');
    expect(serialized).not.toContain('Premium');
  });

  it('keeps ReadMe claims limited to its published plans', () => {
    expect(serialized).toContain('1 project, unlimited versions');
    expect(serialized).not.toContain('Unlimited projects');
    expect(serialized).not.toContain('on-premise');
  });
});
