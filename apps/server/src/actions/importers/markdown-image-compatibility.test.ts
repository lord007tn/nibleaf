import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { convertGhostHtml } from './ghost-mapping';

const require = createRequire(import.meta.url);
const ghostRequire = createRequire(require.resolve('@tryghost/kg-lexical-html-renderer'));
const markdownRequire = createRequire(ghostRequire.resolve('@tryghost/kg-markdown-html-renderer'));
const MarkdownIt = markdownRequire('markdown-it');
const cjsPlugin = markdownRequire('markdown-it-image-lazy-loading');
const pluginPath = markdownRequire.resolve('markdown-it-image-lazy-loading');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP8sAAAAASUVORK5CYII=', 'base64');
// JPEG dimensions live in the SOF metadata; pixel decoding is outside image-size's contract.
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc00011080009000d03011100021100031100ffd9', 'hex');
const maxImageBytes = 16 * 1024 * 1024;
let directory: string;
let esmPlugin: typeof cjsPlugin;

const tiff = (bigEndian: boolean, ifdOffset = 8) => {
  // A complete uncompressed, 8-bit grayscale TIFF, including its pixel strip.
  const entries = [
    [256, 4, 37],
    [257, 4, 19],
    [258, 3, 8],
    [259, 3, 1],
    [262, 3, 1],
    [273, 4, 0],
    [277, 3, 1],
    [278, 4, 19],
    [279, 4, 37 * 19],
  ] as const;
  const pixelOffset = ifdOffset + 2 + entries.length * 12 + 4;
  const input = Buffer.alloc(pixelOffset + 37 * 19);
  input.write(bigEndian ? 'MM' : 'II');
  const write16 = (value: number, offset: number) => (bigEndian ? input.writeUInt16BE(value, offset) : input.writeUInt16LE(value, offset));
  const write32 = (value: number, offset: number) => (bigEndian ? input.writeUInt32BE(value, offset) : input.writeUInt32LE(value, offset));
  write16(42, 2);
  write32(ifdOffset, 4);
  write16(entries.length, ifdOffset);
  for (const [index, [tag, type, value]] of entries.entries()) {
    const entry = ifdOffset + 2 + index * 12;
    write16(tag, entry);
    write16(type, entry + 2);
    write32(1, entry + 4);
    if (type === 3) write16(value, entry + 8);
    else write32(tag === 273 ? pixelOffset : value, entry + 8);
  }
  input.fill(0x7f, pixelOffset);
  return input;
};

beforeAll(async () => {
  esmPlugin = (await import(pathToFileURL(join(dirname(pluginPath), 'index.mjs')).href)).default;
  directory = fs.mkdtempSync(join(tmpdir(), 'nibleaf-image-compat-'));
  fs.writeFileSync(join(directory, 'pixel.png'), png);
  fs.writeFileSync(join(directory, 'photo.jpg'), jpeg);
  fs.writeFileSync(join(directory, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="17"></svg>');
  fs.writeFileSync(join(directory, 'little.tiff'), tiff(false));
  fs.writeFileSync(join(directory, 'big.tiff'), tiff(true));
  fs.writeFileSync(join(directory, 'distant.tiff'), tiff(false, 600 * 1024));
  fs.writeFileSync(join(directory, 'corrupt.bin'), 'This is not image data');
  fs.writeFileSync(join(directory, 'empty.png'), '');
  fs.writeFileSync(join(directory, 'oversized.png'), png);
  fs.truncateSync(join(directory, 'oversized.png'), maxImageBytes + 1);
  fs.mkdirSync(join(directory, 'not-a-file'));
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

describe.each(['CommonJS', 'ESM'])('%s lazy-image compatibility', (entrypoint) => {
  const render = (markdown: string, options?: Record<string, unknown>) =>
    new MarkdownIt().use(entrypoint === 'CommonJS' ? cjsPlugin : esmPlugin, options).render(markdown);

  it('keeps sizing opt-in and preserves lazy/decoding attributes for remote images', () => {
    const markdown = '![Alt](https://example.com/missing.png "Caption")';
    expect(render(markdown)).toBe('<p><img src="https://example.com/missing.png" alt="Alt" title="Caption" loading="lazy"></p>\n');
    expect(render(markdown, { base_path: directory, decoding: true })).toBe(
      '<p><img src="https://example.com/missing.png" alt="Alt" title="Caption" loading="lazy" decoding="async"></p>\n',
    );
    expect(render(markdown, { image_size: true })).not.toContain('width=');
  });

  it.each([
    ['pixel.png', 1, 1],
    ['photo.jpg', 13, 9],
    ['vector.svg', 23, 17],
    ['little.tiff', 37, 19],
    ['big.tiff', 37, 19],
    ['distant.tiff', 37, 19],
  ])('retains dimensions for %s, including TIFF directories beyond 512 KiB', (filename, width, height) => {
    expect(render(`![Alt](${filename})`, { base_path: directory, image_size: true, decoding: true })).toBe(
      `<p><img src="${filename}" alt="Alt" loading="lazy" decoding="async" width="${width}" height="${height}"></p>\n`,
    );
  });

  it('reports missing, corrupt, empty, oversized, and non-regular inputs instead of omitting dimensions', () => {
    const options = { base_path: directory, image_size: true };
    expect(() => render('![Alt](missing.png)', options)).toThrow(/ENOENT/);
    expect(() => render('![Alt](corrupt.bin)', options)).toThrow();
    expect(() => render('![Alt](empty.png)', options)).toThrow('Empty file');
    expect(() => render('![Alt](oversized.png)', options)).toThrow('16 MiB sizing limit');
    expect(() => render('![Alt](not-a-file)', options)).toThrow();
  });

  it('closes the file descriptor when image parsing fails', () => {
    const close = vi.spyOn(fs, 'closeSync');
    expect(() => render('![Alt](corrupt.bin)', { base_path: directory, image_size: true })).toThrow();
    expect(close).toHaveBeenCalledOnce();
  });

  it('bounds the allocation and read to the observed size if the file grows after fstat', () => {
    const filepath = join(directory, `growing-${entrypoint}.png`);
    fs.writeFileSync(filepath, png);
    const originalStat = fs.fstatSync;
    vi.spyOn(fs, 'fstatSync').mockImplementationOnce((descriptor) => {
      const stat = originalStat(descriptor);
      fs.truncateSync(filepath, maxImageBytes + 1);
      return stat;
    });
    const read = vi.spyOn(fs, 'readSync');
    expect(render(`![Alt](growing-${entrypoint}.png)`, { base_path: directory, image_size: true })).toContain('width="1" height="1"');
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[1]?.byteLength).toBe(png.length);
    expect(read).toHaveBeenCalledWith(expect.any(Number), expect.any(Uint8Array), 0, png.length, 0);
  });
});

it('preserves Ghost Markdown HTML and Turndown output with sizing disabled', () => {
  const { render } = ghostRequire('@tryghost/kg-markdown-html-renderer');
  const markdown =
    '# Compatibility\n\n![Alt](https://example.com/image.png "Caption")\n\n[Link](https://example.com) and **bold**, *emphasis*, ~~strike~~.\n\n- First\n- Second\n\n> Quoted\n\n`inline` and H~2~O\n';
  // Captured from the official Ghost renderer before the compatibility patch.
  const expectedHtml =
    '<h1 id="compatibility">Compatibility</h1>\n<p><img src="https://example.com/image.png" alt="Alt" title="Caption" loading="lazy"></p>\n<p><a href="https://example.com">Link</a> and <strong>bold</strong>, <em>emphasis</em>, <s>strike</s>.</p>\n<ul>\n<li>First</li>\n<li>Second</li>\n</ul>\n<blockquote>\n<p>Quoted</p>\n</blockquote>\n<p><code>inline</code> and H<sub>2</sub>O</p>\n';
  const html = render(markdown);
  expect(html).toBe(expectedHtml);
  expect(convertGhostHtml(html)).toEqual({
    markdown:
      '# Compatibility\n\n![Alt](https://example.com/image.png "Caption")\n\n[Link](https://example.com) and **bold**, _emphasis_, ~strike~.\n\n-   First\n-   Second\n\n> Quoted\n\n`inline` and H2O',
    usedFallback: false,
    hadGhostUrls: false,
  });
});
