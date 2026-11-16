import { describe, expect, it } from 'vitest';
import { readAskSearch } from './ask-search';

describe('readAskSearch', () => {
  it('parses bounded deep links without breaking the route', () => {
    expect(readAskSearch('  How?  ')).toBe('How?');
    for (const value of ['', 'x', 'a'.repeat(501), 42, []]) expect(readAskSearch(value)).toBeUndefined();
  });
});
