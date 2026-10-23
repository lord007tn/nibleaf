import { beforeEach, describe, expect, it, vi } from 'vitest';

const remote = vi.hoisted(() => ({ got: vi.fn() }));

vi.mock('../assets', () => ({ findImportedAsset: vi.fn(), storeAsset: vi.fn() }));
vi.mock('got', () => ({ default: remote.got }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));

import { findImportedAsset, storeAsset } from '../assets';
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

describe('RemoteAssetMigrator content types', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const serve = (body: Uint8Array, contentType: string) =>
    remote.got.mockResolvedValue({ statusCode: 200, ok: true, headers: { 'content-type': contentType }, rawBody: Buffer.from(body) });

  beforeEach(() => vi.mocked(findImportedAsset).mockResolvedValue(null as never));

  it('identifies an extensionless image served as octet-stream by its bytes', async () => {
    serve(png, 'application/octet-stream');
    vi.mocked(storeAsset).mockResolvedValue({ url: 'https://storage.example.com/stored.png' } as never);
    const assets = new RemoteAssetMigrator('synthetic', 'gitbook');

    expect(await assets.rewrite('![Shot](https://raw.example.com/.gitbook/assets/image)')).toBe('![Shot](https://storage.example.com/stored.png)');
    expect(storeAsset).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png', filename: 'image' }));
    expect(assets.migrated).toBe(1);
  });

  it('identifies an extensionless AVIF by its brand', async () => {
    serve(Uint8Array.from([0, 0, 0, 0x1c, ...new TextEncoder().encode('ftypavif'), 0, 0, 0, 0]), 'application/octet-stream');
    vi.mocked(storeAsset).mockResolvedValue({ url: 'https://storage.example.com/stored.avif' } as never);

    await new RemoteAssetMigrator('synthetic', 'gitbook').rewrite('![Shot](https://raw.example.com/.gitbook/assets/photo)');

    expect(storeAsset).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/avif' }));
  });

  it('still refuses a body that is not a known image', async () => {
    serve(new TextEncoder().encode('<!doctype html><title>nope</title>'), 'application/octet-stream');
    const assets = new RemoteAssetMigrator('synthetic', 'gitbook');
    const source = '![Shot](https://raw.example.com/.gitbook/assets/page)';

    expect(await assets.rewrite(source)).toBe(source);
    expect(storeAsset).not.toHaveBeenCalled();
    expect([...assets.failures]).toEqual(['unsupported image type']);
  });
});

describe('RemoteAssetMigrator download cap', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  beforeEach(() => {
    remote.got.mockResolvedValue({ statusCode: 200, ok: true, headers: { 'content-type': 'image/png' }, rawBody: Buffer.from(png) });
    vi.mocked(storeAsset).mockImplementation(async ({ importId }) => ({ url: `https://storage.example.com/${importId}.png` }) as never);
  });

  it('reuses stored images without spending the download cap on them', async () => {
    vi.mocked(findImportedAsset).mockImplementation(async (_project, _importId, filename) =>
      filename.startsWith('stored') ? ({ url: `https://storage.example.com/${filename}` } as never) : null,
    );
    const assets = new RemoteAssetMigrator('synthetic', 'gitbook', 1);
    const page = ['stored-1.png', 'stored-2.png', 'stored-3.png', 'new-1.png', 'new-2.png']
      .map((name) => `![](https://cdn.example.com/${name})`)
      .join('\n');

    const result = await assets.rewrite(page);

    expect(result).toContain('https://storage.example.com/stored-3.png');
    expect(assets.migrated).toBe(1);
    expect(assets.skipped).toBe(1);
    expect(remote.got).toHaveBeenCalledTimes(1);
  });

  it('reports the download cap first among failure reasons', async () => {
    vi.mocked(findImportedAsset).mockResolvedValue(null as never);
    remote.got
      .mockResolvedValueOnce({ statusCode: 404, ok: false, headers: {}, rawBody: Buffer.alloc(0) })
      .mockResolvedValueOnce({ statusCode: 403, ok: false, headers: {}, rawBody: Buffer.alloc(0) })
      .mockResolvedValueOnce({ statusCode: 400, ok: false, headers: {}, rawBody: Buffer.alloc(0) });
    const assets = new RemoteAssetMigrator('synthetic', 'gitbook', 3);
    for (const name of ['a', 'b', 'c', 'd']) await assets.rewrite(`![](https://cdn.example.com/${name}.png)`);

    expect(assets.failureReasons()).toBe('Asset migration was capped at 3 downloaded images.; remote response 404; remote response 403');
  });
});
