import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const brandRoot = resolve(appRoot, 'public/brand');
const reversibleSourcePath = 'M148 368V144L364 368V144';

function readPublicFile(relativePath: string) {
  return readFileSync(resolve(appRoot, 'public', relativePath), 'utf8');
}

describe('Nibleaf brand assets', () => {
  it('keeps one canonical Reversible Source geometry across standalone mark variants', () => {
    for (const filename of ['nibleaf-icon.svg', 'nibleaf-icon-reverse.svg', 'nibleaf-icon-currentcolor.svg', 'nibleaf-icon-monochrome.svg']) {
      expect(readFileSync(resolve(brandRoot, filename), 'utf8')).toContain(reversibleSourcePath);
    }
  });

  it('keeps the source SVG family free of the retired pen and leaf geometry', () => {
    const retiredGeometry = ['M173 300', 'M426 393', 'M68 138', 'M824 138', 'M346 600'];
    const sources = readdirSync(brandRoot).filter((filename) => filename.endsWith('.svg'));

    expect(sources.length).toBeGreaterThanOrEqual(25);
    for (const filename of sources) {
      const source = readFileSync(resolve(brandRoot, filename), 'utf8');
      for (const geometry of retiredGeometry) expect(source).not.toContain(geometry);
    }
  });

  it('uses the canonical Ink and Paper colors in both public app manifests', () => {
    const appManifest = JSON.parse(readPublicFile('site.webmanifest')) as { theme_color: string; background_color: string };
    const adminManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'apps/admin/public/site.webmanifest'), 'utf8')) as {
      theme_color: string;
      background_color: string;
    };

    for (const manifest of [appManifest, adminManifest]) {
      expect(manifest.theme_color).toBe('#181612');
      expect(manifest.background_color).toBe('#FBF7EE');
    }
  });

  it('tracks every generated raster with its real dimensions', () => {
    const entries = JSON.parse(readFileSync(resolve(brandRoot, 'raster/manifest.json'), 'utf8')) as Array<{
      file: string;
      width: number;
      height: number;
    }>;

    expect(entries.length).toBeGreaterThanOrEqual(40);
    for (const entry of entries) {
      const path = resolve(repositoryRoot, entry.file);
      expect(existsSync(path), entry.file).toBe(true);
      if (!entry.file.endsWith('.png')) continue;
      const png = readFileSync(path);
      expect(png.subarray(1, 4).toString('ascii'), entry.file).toBe('PNG');
      expect(png.readUInt32BE(16), `${entry.file} width`).toBe(entry.width);
      expect(png.readUInt32BE(20), `${entry.file} height`).toBe(entry.height);
    }
  });
});
