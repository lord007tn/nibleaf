import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ asset: vi.fn(), object: vi.fn(), remote: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { asset: { findUnique: mocks.asset } } }));
vi.mock('@nibleaf/storage', () => ({ getObjectStream: mocks.object }));
vi.mock('@/actions/importers/ghost-assets', () => ({ fetchPublicImage: mocks.remote }));

import { cachedSiteOg, renderSiteOg, type SiteOgData, siteOgEtag } from './site-og';

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
