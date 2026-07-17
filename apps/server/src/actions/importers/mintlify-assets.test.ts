import { describe, expect, it } from 'vitest';
import { resolveMintlifyConfigAsset, rewriteMintlifyAssetReferences } from './mintlify-assets';

describe('rewriteMintlifyAssetReferences', () => {
  it('resolves root/relative Markdown and MDX images while preserving external URLs', () => {
    const input = [
      '![Root](/images/root.png)',
      '![Relative](../assets/step.jpg "Step")',
      '<Frame><img src="./inline.webp" /></Frame>',
      '<img src="https://cdn.example.com/kept.png" />',
    ].join('\n');
    const blobs = new Set(['images/root.png', 'guides/assets/step.jpg', 'guides/setup/inline.webp']);
    const result = rewriteMintlifyAssetReferences(input, 'guides/setup/page.mdx', blobs, (path) => `https://raw.example/${path}`);
    expect(result.content).toContain('![Root](https://raw.example/images/root.png)');
    expect(result.content).toContain('![Relative](https://raw.example/guides/assets/step.jpg "Step")');
    expect(result.content).toContain('<img src="https://raw.example/guides/setup/inline.webp"');
    expect(result.content).toContain('https://cdn.example.com/kept.png');
    expect(result.resolved).toHaveLength(3);
    expect(result.missing).toEqual([]);
  });

  it('reports missing repo-relative images without changing their reference', () => {
    const result = rewriteMintlifyAssetReferences('![Missing](./missing.png)', 'docs/page.mdx', new Set(), (path) => path);
    expect(result.content).toBe('![Missing](./missing.png)');
    expect(result.missing).toEqual(['./missing.png']);
  });
});

describe('resolveMintlifyConfigAsset', () => {
  it('resolves root and config-relative branding paths only when the file exists', () => {
    const blobs = new Set(['logo.svg', 'docs/favicon.png']);
    const raw = (path: string) => `https://raw.example/${path}`;
    expect(resolveMintlifyConfigAsset('/logo.svg', 'docs/docs.json', blobs, raw)).toBe('https://raw.example/logo.svg');
    expect(resolveMintlifyConfigAsset('./favicon.png', 'docs/docs.json', blobs, raw)).toBe('https://raw.example/docs/favicon.png');
    expect(resolveMintlifyConfigAsset('/missing.svg', 'docs/docs.json', blobs, raw)).toBeUndefined();
  });
});
