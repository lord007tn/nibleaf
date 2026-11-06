import { describe, expect, it } from 'vitest';
import { askSearchSchema } from './ask-search';

describe('askSearchSchema', () => {
  it('parses bounded deep links without breaking the route', () => {
    expect(askSearchSchema.parse('  How?  ')).toBe('How?');
    for (const value of ['', 'x', 'a'.repeat(501), 42, []]) expect(askSearchSchema.parse(value)).toBeUndefined();
  });
});
