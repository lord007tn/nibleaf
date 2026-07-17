import { describe, expect, it, vi } from 'vitest';

vi.mock('../assets', () => ({ findImportedAsset: vi.fn(), storeAsset: vi.fn() }));

import { remoteImageSources } from './ghost-assets';

describe('remoteImageSources', () => {
  it('finds and deduplicates Markdown plus HTML/MDX image sources', () => {
    const markdown = [
      '![Step](https://cdn.example.com/step.png)',
      '<img src="https://cdn.example.com/inline.jpg" />',
      '<Image alt="x" src="https://cdn.example.com/inline.jpg" />',
      '[ordinary link](https://example.com/page)',
    ].join('\n');
    expect(remoteImageSources(markdown)).toEqual(['https://cdn.example.com/step.png', 'https://cdn.example.com/inline.jpg']);
  });
});
