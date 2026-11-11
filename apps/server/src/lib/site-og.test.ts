import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ asset: vi.fn(), object: vi.fn(), remote: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { asset: { findUnique: mocks.asset } } }));
vi.mock('@nibleaf/storage', () => ({ getObjectStream: mocks.object }));
vi.mock('@/actions/importers/ghost-assets', () => ({ fetchPublicImage: mocks.remote }));

import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { cachedSiteOg, renderSiteOg, type SiteOgData, siteOgEtag, titleFontSize, titleLines } from './site-og';

const data: SiteOgData = {
  projectId: 'project',
  deploymentId: 'deployment',
  title: 'Start building with Acme',
  siteName: 'Acme Docs',
  brandColor: '#16a34a',
  logo: null,
  rtl: false,
};
afterEach(() => vi.unstubAllEnvs());

describe('server-only OG renderer', () => {
  it('renders Arabic and mixed RTL text with the bundled fonts into a real PNG', async () => {
    const image = await renderSiteOg({ ...data, title: 'دَلِيلُ الاستخدام API والمصادقة', siteName: 'وثائق أكمي', rtl: true });
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
    const blank = await renderSiteOg({ ...data, title: '', siteName: '', rtl: true });
    expect(image.length).toBeGreaterThan(blank.length + 3000);
  });

  it('keys ETags on every content input and the running revision', () => {
    const original = siteOgEtag(data);
    for (const change of [
      { title: 'Changed' },
      { siteName: 'Changed' },
      { brandColor: '#ff0000' },
      { deploymentId: 'next' },
      { logo: 'https://cdn/logo.png' },
      { rtl: true },
    ]) {
      expect(siteOgEtag({ ...data, ...change })).not.toBe(original);
    }
    vi.stubEnv('NIBLEAF_REVISION', 'next-revision');
    expect(siteOgEtag(data)).not.toBe(original);
  });

  it('uses configured shorthand brand colours and rejects CSS injection', async () => {
    expect(await renderSiteOg({ ...data, brandColor: '#abc' })).toEqual(await renderSiteOg({ ...data, brandColor: '#aabbcc' }));
    expect(await renderSiteOg({ ...data, brandColor: '"><image href="file:///etc/passwd"/>' })).toEqual(
      await renderSiteOg({ ...data, brandColor: '#2563eb' }),
    );
  });

  it('coalesces identical renders and refuses a third concurrent cold card', async () => {
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.remote.mockImplementation(async () => {
      await hold;
      throw new Error('optional logo unavailable');
    });
    const card = { ...data, logo: 'https://cdn.example/logo.png' };
    const first = cachedSiteOg(card);
    expect(cachedSiteOg(card)).toBe(first);
    const second = cachedSiteOg({ ...card, title: 'Second' });
    expect(cachedSiteOg({ ...card, title: 'Third' })).toBeNull();
    release?.();
    await Promise.all([first, second]);
    expect(await cachedSiteOg(card)).toEqual(await first);
  });

  it('embeds a small owned raster logo and refuses cross-project stored assets', async () => {
    const logo = await renderSiteOg({ ...data, title: '', siteName: '' });
    // A generated card is a small valid PNG and stays below the dimension cap.
    mocks.asset.mockResolvedValue({ projectId: 'project', size: logo.byteLength });
    mocks.object.mockImplementation(async () => Readable.from([logo]));
    const owned = await renderSiteOg({ ...data, logo: '/api/public/assets/projects/project/assets/logo.png' });
    expect(mocks.object).toHaveBeenCalled();
    expect(owned).not.toEqual(await renderSiteOg(data));
    mocks.object.mockClear();
    const foreign = await renderSiteOg({ ...data, logo: '/api/public/assets/projects/other/assets/logo.png' });
    expect(mocks.object).not.toHaveBeenCalled();
    expect(foreign).toEqual(await renderSiteOg(data));
  });

  it('caps cold generations per minute while allowing cached cards and recovery next minute', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    try {
      for (let index = 0; index < 30; index++) expect(await cachedSiteOg({ ...data, title: `Budget ${index}` })).toBeInstanceOf(Buffer);
      expect(cachedSiteOg({ ...data, title: 'Over budget' })).toBeNull();
      expect(await cachedSiteOg({ ...data, title: 'Budget 0' })).toBeInstanceOf(Buffer);
      clock.mockReturnValue(Date.now() + 60_001);
      expect(await cachedSiteOg({ ...data, title: 'Recovered' })).toBeInstanceOf(Buffer);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('OG title wrapping', () => {
  it('keeps punctuation attached to its word', () => {
    const title = 'Introduction to Nibleaf: write, publish and answer questions from your docs';
    const lines = titleLines(title);
    expect(lines.join(' ')).toBe(title);
    expect(lines).toContain('write, publish and answer');
    for (const line of lines) {
      expect(line).not.toMatch(/^[,.:;!?)]/);
      expect(Array.from(line).length).toBeLessThanOrEqual(30);
    }
  });

  it('wraps Arabic at word boundaries without splitting words', () => {
    const title = 'مقدمة إلى Nibleaf: اكتب وانشر وأجب عن الأسئلة من وثائقك';
    const lines = titleLines(title);
    expect(lines.join(' ')).toBe(title);
    for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(30);
  });

  it('splits only a single token longer than a line, by graphemes', () => {
    const lines = titleLines(`${'a'.repeat(45)} end`);
    expect(lines[0]).toHaveLength(30);
    expect(lines.join('')).toBe(`${'a'.repeat(45)} end`);
  });

  it('caps the card at four lines', () => {
    expect(titleLines(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')).length).toBeLessThanOrEqual(4);
  });
});

describe('OG title size: one renderer per card', () => {
  const fontFile = fileURLToPath(new URL('../assets/og/NotoSansArabic.ttf', import.meta.url));
  /** Real rendered width of a line, measured with resvg itself (test only). */
  const realWidth = (line: string, size: number, rtl = false) => {
    const text = rtl ? `&#x202b;${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}&#x202c;` : line.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="200"><text x="10" y="120" font-family="Noto Sans Arabic" font-size="${size}">${text}</text></svg>`;
    return new Resvg(svg, { font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: 'Noto Sans Arabic' } }).innerBBox()?.width ?? 0;
  };

  it.each([
    ['wide capitals', 'W'.repeat(30)],
    ['wide lowercase', 'mwmwmwmwmwmwmwmwmwmwmwmwmwmwmw'],
    ['capitals and digits', 'AUTHENTICATION 2026 OVERVIEW XY'],
    ['typical title', 'Introduction to Nibleaf: write,'],
    ['Arabic', 'مقدمة إلى Nibleaf: اكتب وانشر'],
    ['Arabic with tashkeel', 'مَرْحَبًا بِكُمْ فِي الوَثَائِقِ الجَدِيدَة'],
  ])('fits the widest titles in the 1040 px box: %s', (_, line) => {
    const size = titleFontSize([line]);
    expect(realWidth(line, size, /\p{Script=Arabic}/u.test(line))).toBeLessThanOrEqual(1040);
  });

  it('keeps typical titles large', () => {
    expect(titleFontSize(titleLines('Introduction to Nibleaf: write, publish and answer questions from your docs'))).toBeGreaterThanOrEqual(52);
  });
});
