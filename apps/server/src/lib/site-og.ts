import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prisma } from '@nibleaf/database';
import { truncateText } from '@nibleaf/shared/utils';
import { getObjectStream } from '@nibleaf/storage';
import { renderAsync } from '@resvg/resvg-js';
import { imageSize } from 'image-size';
import { fetchPublicImage } from '@/actions/importers/ghost-assets';
import { LruCache } from './lru';

export interface SiteOgData {
  projectId: string;
  deploymentId: string;
  title: string;
  siteName: string;
  brandColor: string;
  logo: string | null;
  rtl: boolean;
}

const fontDirectory = new URL(import.meta.url.endsWith('.ts') ? '../assets/og/' : './assets/og/', import.meta.url);
const font = {
  fontFiles: [fileURLToPath(new URL('NotoSansArabic.ttf', fontDirectory))],
  loadSystemFonts: false,
  defaultFontFamily: 'Noto Sans Arabic',
};
const MAX_LOGO_BYTES = 512 * 1024;
const images = new LruCache<string, Buffer>(16 * 1024 * 1024, (image) => image.byteLength);
const pending = new Map<string, Promise<Buffer>>();
let generationWindow = 0;
let generations = 0;

export const siteOgEtag = (data: SiteOgData): string =>
  `"${createHash('sha256')
    .update(JSON.stringify([data, process.env.NIBLEAF_REVISION ?? 'development', 'og-v1']))
    .digest('hex')}"`;

const xml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char);

// This resvg release does not implement SVG's direction attribute. A Unicode
// RTL embedding gives its bidi engine the correct base for mixed Arabic/Latin.
const svgText = (text: string, rtl: boolean): string => (rtl ? `&#x202b;${xml(text)}&#x202c;` : xml(text));

/** Only embed small raster images. No SVG subresources, filesystem paths or
 * remote URLs ever reach the native renderer. External fetches use the existing
 * DNS-pinned public-image downloader (including every redirect). */
const logoData = async (data: SiteOgData): Promise<string | null> => {
  if (!data.logo) return null;
  try {
    const url = new URL(data.logo, 'https://og.invalid');
    let bytes: Uint8Array;
    if (url.pathname.startsWith('/api/public/assets/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/public/assets/'.length));
      if (
        !key.startsWith(`projects/${data.projectId}/assets/`) ||
        key.split('/').some((part) => !part || part === '.' || part === '..') ||
        key.includes('\\')
      )
        return null;
      const asset = await prisma.asset.findUnique({ where: { key }, select: { projectId: true, size: true } });
      if (asset?.projectId !== data.projectId || Number(asset.size) > MAX_LOGO_BYTES) return null;
      const stream = await getObjectStream(key, undefined, AbortSignal.timeout(3000));
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > MAX_LOGO_BYTES) return null;
          chunks.push(buffer);
        }
      } finally {
        stream.destroy();
      }
      bytes = Buffer.concat(chunks);
    } else {
      if (url.hostname === 'og.invalid') return null;
      bytes = (await fetchPublicImage(url.href, MAX_LOGO_BYTES, 1500)).bytes;
    }
    const dimensions = imageSize(bytes);
    if (!['png', 'jpg', 'gif', 'webp'].includes(dimensions.type ?? '') || dimensions.width > 2048 || dimensions.height > 2048) return null;
    const type = dimensions.type === 'jpg' ? 'jpeg' : dimensions.type;
    return `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    // Optional branding failure must not prevent a title card from unfurling.
    return null;
  }
};

const TITLE_LINE = 30;
const graphemes = (text: string): string[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (item) => item.segment);

/** Wrap at whitespace, so punctuation stays attached to its word ("write,"
 *  never becomes "write" + ", publish"), before passing complete logical lines
 *  to resvg's bidi/shaping engine. Only a single token longer than a line is
 *  split, and then by graphemes, so Arabic is never reversed or broken apart. */
export const titleLines = (title: string): string[] => {
  const text = truncateText(title, 120);
  const lines: string[] = [];
  let line: string[] = [];
  const flush = () => {
    const value = line.join('').trim();
    if (value) lines.push(value);
    line = [];
  };
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const units = graphemes(token);
    const needed = (line.length ? line.length + 1 : 0) + units.length;
    if (needed > TITLE_LINE && line.length) flush();
    if (units.length > TITLE_LINE) {
      for (const unit of units) {
        if (line.length >= TITLE_LINE) flush();
        line.push(unit);
      }
      continue;
    }
    if (line.length) line.push(' ');
    line.push(...units);
  }
  flush();
  return lines.length > 4 ? [...lines.slice(0, 3), truncateText(lines.slice(3).join(' '), TITLE_LINE)] : lines;
};

/** Conservative advance widths in em for Noto Sans Arabic, by character class.
 *  Each card renders with ONE native renderer: resvg-js 2.6.2 reads font files
 *  per instance and has no font-buffer API (only the 2.7 alphas do), so a
 *  separate measuring pass would load the font twice per card. The test
 *  'fits the widest titles' checks these bounds against real glyph widths. */
const advance = (char: string): number => {
  if (char === ' ') return 0.26;
  if (/[iljIt.,:;'|!()[\]]/u.test(char)) return 0.34;
  if (/[mwMW@%]/u.test(char)) return 0.98;
  if (/[A-Z]/u.test(char)) return 0.74;
  // Lowercase Latin, digits, Arabic (contextual forms) and everything else.
  return 0.62;
};

const TITLE_WIDTH = 1040;
const TITLE_MAX_SIZE = 64;

/** Largest font size (at most 64) at which every line fits the 1040 px text box. */
export const titleFontSize = (lines: string[]): number => {
  const widest = Math.max(1, ...lines.map((line) => graphemes(line).reduce((sum, unit) => sum + advance(unit), 0)));
  return Math.min(TITLE_MAX_SIZE, Math.floor(TITLE_WIDTH / widest));
};

export const renderSiteOg = async (data: SiteOgData): Promise<Buffer> => {
  const logo = await logoData(data);
  const color = /^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(data.brandColor) ? data.brandColor : '#2563eb';
  const x = data.rtl ? 1120 : 80;
  const anchor = data.rtl ? 'end' : 'start';
  const lines = titleLines(data.title);
  const text = lines
    .map((line, index) => `<text x="${x}" y="${240 + index * 78}" text-anchor="${anchor}">${svgText(line, data.rtl)}</text>`)
    .join('');
  const size = titleFontSize(lines);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#101827"/>
    <rect width="1200" height="18" fill="${color}"/>
    <circle cx="1160" cy="650" r="230" fill="${color}" opacity="0.18"/>
    ${logo ? `<image href="${logo}" x="${data.rtl ? 1040 : 80}" y="62" width="80" height="80" preserveAspectRatio="xMidYMid meet"/>` : ''}
    <g fill="#ffffff" font-family="Noto Sans Arabic" font-size="${size}">${text}</g>
    <text x="${x}" y="570" text-anchor="${anchor}" fill="#cbd5e1" font-family="Noto Sans Arabic" font-size="28">${svgText(truncateText(data.siteName, 55), data.rtl)}</text>
  </svg>`;
  return (await renderAsync(svg, { font })).asPng();
};

/** Per-process limits: 16 MiB LRU, two in-flight renders (same-key coalesced),
 * 30 cold generations/minute across all clients. Admission happens before any
 * logo I/O; a random-path flood cannot create an unbounded queue. */
export const cachedSiteOg = (data: SiteOgData): Promise<Buffer> | null => {
  const key = siteOgEtag(data);
  const cached = images.get(key);
  if (cached) return Promise.resolve(cached);
  const running = pending.get(key);
  if (running) return running;
  const now = Date.now();
  if (now - generationWindow >= 60_000) {
    generationWindow = now;
    generations = 0;
  }
  if (pending.size >= 2 || generations >= 30) return null;
  generations += 1;
  const result = renderSiteOg(data)
    .then((image) => {
      images.set(key, image);
      return image;
    })
    .finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
};
