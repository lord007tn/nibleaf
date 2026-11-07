// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { marketingMedia } from './manifest';
import { MarketingMedia } from './marketing-media';

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

it('offers a still for reduced motion before the animated WebP source', () => {
  vi.mocked(marketingMedia).mockReturnValue({ wide, loop: { src: '/flow.webp', width: 960, height: 600 } });
  const root = render();
  const sources = [...root.querySelectorAll('source')];
  expect(sources[0]?.getAttribute('media')).toBe('(prefers-reduced-motion: reduce)');
  expect(sources[0]?.getAttribute('srcset')).toBe(wide.avif);
  expect(sources[1]?.getAttribute('srcset')).toBe(wide.webp);
  expect(sources[2]?.getAttribute('srcset')).toBe('/flow.webp');
  expect(root.querySelector('img')?.getAttribute('loading')).toBe('lazy');
});

it('makes a missing capture explicit instead of inventing a product mock', () => {
  vi.mocked(marketingMedia).mockReturnValue(undefined);
  const root = render();
  expect(root.querySelector('img')).toBeNull();
  expect(root.textContent).toContain(media.alt);
  expect(root.querySelector('.aspect-\\[8\\/5\\]')).not.toBeNull();
});
