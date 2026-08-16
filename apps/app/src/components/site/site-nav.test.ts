import { describe, expect, it } from 'vitest';
import { isVersionIndependentNavNode } from './site-nav';

describe('isVersionIndependentNavNode', () => {
  it('keeps synthetic OpenAPI navigation outside branch URL prefixes', () => {
    expect(isVersionIndependentNavNode({ id: 'openapi:hash' })).toBe(true);
    expect(isVersionIndependentNavNode({ id: 'page_123' })).toBe(false);
  });
});
