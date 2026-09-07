import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets', () => ({ findImportedAsset: vi.fn(), storeAsset: vi.fn() }));

import { findImportedAsset } from '../assets';
import { RemoteAssetMigrator, remoteImageSources } from './ghost-assets';

beforeEach(() => vi.clearAllMocks());

describe('remoteImageSources', () => {
  it('does no asset lookup or migration for a code-only document', async () => {
    const input = '~~~mdx\n<img src="https://cdn.example.com/code.png" />\n~~~';
    const assets = new RemoteAssetMigrator('synthetic');
    expect(await assets.rewrite(input)).toBe(input);
    expect(findImportedAsset).not.toHaveBeenCalled();
    expect(assets.migrated).toBe(0);
    expect(assets.skipped).toBe(0);
  });
  it('does not discover literal images in fenced or inline code', () => {
    const example = [
      '````mdx',
      '<img src="https://cdn.example.com/code.png" />',
      '```',
      '![Example](https://cdn.example.com/markdown.png)',
      '````',
      '`<img src="https://cdn.example.com/inline.png" />`',
    ].join('\n');
    expect(remoteImageSources(example)).toEqual([]);
  });

  it('migrates a real image without rewriting the same URL in code or an ordinary link', async () => {
    const source = 'https://cdn.example.com/shared.png';
    const hosted = 'https://storage.example.com/imported.png';
    vi.mocked(findImportedAsset).mockResolvedValue({ url: hosted } as never);
    const literal = ['~~~mdx', `<img src="${source}" />`, '~~~', `\`![Literal](${source})\``, `[Source](${source})`].join('\n');
    const result = await new RemoteAssetMigrator('synthetic').rewrite(`![Real](${source})\n${literal}`);
    expect(result).toBe(`![Real](${hosted})\n${literal}`);
    expect(findImportedAsset).toHaveBeenCalledOnce();
  });
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
