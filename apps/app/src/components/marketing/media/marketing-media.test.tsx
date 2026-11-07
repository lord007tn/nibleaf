// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { marketingMedia } from './manifest';
import { HeroMedia, MarketingMedia } from './marketing-media';

vi.mock('./manifest', () => ({ marketingMedia: vi.fn() }));
const wide = { width: 1280, height: 800, avif: '/wide.avif 1280w', webp: '/wide.webp 1280w', fallback: '/wide.webp' };
const phone = { width: 390, height: 844, avif: '/phone.avif 390w', webp: '/phone.webp 390w', fallback: '/phone.webp' };
const media = { key: 'hero-chat' as const, alt: 'Docs answer with cited sources', caption: 'Fictional demo project' };
afterEach(() => vi.resetAllMocks());

function render(priority = false) {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(<MarketingMedia lang="en" media={media} priority={priority} />);
  return root;
}

it('serves phone AVIF then WebP, reserves intrinsic dimensions, and prioritizes hero media', () => {
  vi.mocked(marketingMedia).mockReturnValue({ wide, phone });
  const root = render(true);
  const sources = root.querySelectorAll('source');
  expect(sources[0]?.getAttribute('type')).toBe('image/avif');
  expect(sources[0]?.getAttribute('media')).toBe('(max-width: 639px)');
  expect(sources[0]?.getAttribute('width')).toBe('390');
  expect(sources[0]?.getAttribute('height')).toBe('844');
  expect(sources[1]?.getAttribute('type')).toBe('image/webp');
  const image = root.querySelector('img');
  expect(image?.getAttribute('width')).toBe('1280');
  expect(image?.getAttribute('height')).toBe('800');
  expect(image?.getAttribute('alt')).toBe(media.alt);
  expect(image?.getAttribute('loading')).toBe('eager');
  expect(image?.getAttribute('fetchpriority')).toBe('high');
  expect(image?.getAttribute('decoding')).toBe('async');
  expect(image?.getAttribute('sizes')).toContain('580px');
  expect(root.querySelector('figcaption')?.textContent).toBe(media.caption);
});

it('keeps theme-hidden pictures lazy so they do not eagerly fetch', () => {
  vi.mocked(marketingMedia).mockReturnValue({ wide, phone, wideDark: { ...wide, fallback: '/dark.webp' } });
  const root = render();
  expect(root.querySelectorAll('picture')).toHaveLength(2);
  expect(root.querySelector('picture.dark\\:hidden')).not.toBeNull();
  expect(root.querySelector('picture.hidden.dark\\:block img')?.getAttribute('src')).toBe('/dark.webp');
  for (const image of root.querySelectorAll('img')) expect(image.getAttribute('loading')).toBe('lazy');
});

it('gives first-screen media one eager image whose dark capture follows the colour scheme', () => {
  const darkWide = { ...wide, avif: '/dark.avif 1280w', webp: '/dark.webp 1280w', fallback: '/dark.webp' };
  vi.mocked(marketingMedia).mockReturnValue({ wide, wideDark: darkWide });
  const root = render(true);
  expect(root.querySelectorAll('picture')).toHaveLength(1);
  expect(root.querySelectorAll('img')).toHaveLength(1);
  expect(root.querySelector('img')?.getAttribute('loading')).toBe('eager');
  const dark = root.querySelector('source[media="(prefers-color-scheme: dark)"][type="image/avif"]');
  expect(dark?.getAttribute('srcset')).toBe(darkWide.avif);
});

it('loads a recording only on request: lazy still and a play button, no video until clicked', async () => {
  vi.mocked(marketingMedia).mockReturnValue({ wide, video: { src: '/journey.webm', width: 1280, height: 720 } });
  const root = render();
  expect(root.querySelector('video')).toBeNull();
  expect(root.querySelector('img')?.getAttribute('loading')).toBe('lazy');
  expect(root.querySelector('img')?.getAttribute('alt')).toBe(media.alt);
  expect(root.querySelector('button')?.textContent).toBe('Play the recording');

  const container = document.createElement('div');
  document.body.append(container);
  const client = createRoot(container);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try {
    await act(async () => client.render(<MarketingMedia lang="ar" media={media} />));
    expect(container.querySelector('button')?.textContent).toBe('شغّل التسجيل');
    await act(async () => container.querySelector('button')?.click());
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/journey.webm');
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.getAttribute('aria-label')).toBe(media.alt);
  } finally {
    await act(async () => client.unmount());
    container.remove();
  }
});

it('composes the hero: desktop capture never downloads on phones and follows the dark colour scheme', () => {
  const wideDark = { ...wide, avif: '/dark.avif 1280w', webp: '/dark.webp 1280w', fallback: '/dark.webp' };
  vi.mocked(marketingMedia).mockReturnValue({ wide, wideDark, phone });
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(<HeroMedia lang="en" media={media} />);
  const [desktop, overlay] = root.querySelectorAll('picture');
  const desktopSources = [...(desktop?.querySelectorAll('source') ?? [])];
  expect(desktop?.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(desktopSources[0]?.getAttribute('media')).toBe('(max-width: 639px)');
  expect(desktopSources[0]?.getAttribute('srcset')).toMatch(/^data:image\/gif;base64,/);
  expect(desktopSources[1]?.getAttribute('media')).toBe('(prefers-color-scheme: dark)');
  expect(desktopSources[1]?.getAttribute('srcset')).toBe(wideDark.avif);
  expect(desktop?.querySelector('img')?.getAttribute('loading')).toBe('eager');
  expect(root.querySelectorAll('picture')).toHaveLength(2);
  const overlayImage = overlay?.querySelector('img');
  expect(overlayImage?.getAttribute('alt')).toBe(media.alt);
  expect(overlayImage?.getAttribute('loading')).toBe('lazy');
  expect(overlayImage?.hasAttribute('fetchpriority')).toBe(false);
});

it('makes a missing capture explicit instead of inventing a product mock', () => {
  vi.mocked(marketingMedia).mockReturnValue(undefined);
  const root = render();
  expect(root.querySelector('img')).toBeNull();
  expect(root.textContent).toContain(media.alt);
  expect(root.querySelector('.aspect-\\[8\\/5\\]')).not.toBeNull();
});
