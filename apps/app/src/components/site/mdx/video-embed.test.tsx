// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RichMarkdown from '@/components/markdown-rich';
import { VideoEmbed } from './video-embed';

/** A Mintlify page with its documented iframe and video shapes, as the Mintlify
 *  importer stores it (pinned by apps/server's mintlify-mdx test). */
const FIXTURE = readFileSync(resolve(process.cwd(), '../../packages/shared/src/__fixtures__/mintlify-video-embeds.imported.mdx'), 'utf8');
/** The page body, after its front matter (the reader renders the body only). */
const MINTLIFY_PAGE = FIXTURE.slice(FIXTURE.indexOf('---\n', 4) + 4);
const PLAY = '[data-theme-component="video-embed"] button';
const PROVIDER_HOSTS = /youtube|youtu\.be|vimeo|loom\.com|wistia/i;

describe('reader video embeds', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderPage = async (content: string, lang = 'en') => {
    await act(async () => root.render(<RichMarkdown content={content} site={{ projectId: 'p', lang, defaultLanguage: 'en' }} />));
  };

  it('shows a play button per allowlisted video and contacts no provider before the click', async () => {
    await renderPage(MINTLIFY_PAGE);
    const buttons = [...container.querySelectorAll('[data-theme-component="video-embed"] button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Play video: YouTube video player (loads from YouTube)',
      'Play video: Loom walkthrough (loads from Loom)',
    ]);
    expect(container.querySelector('iframe')).toBeNull();
    // No player, thumbnail, preconnect or link to a provider: nothing a browser would fetch.
    expect(container.querySelectorAll('img, link, script')).toHaveLength(0);
    const addresses = [...container.querySelectorAll('*')].flatMap((element) =>
      ['src', 'href', 'srcset', 'poster', 'style'].flatMap((name) => element.getAttribute(name) ?? []),
    );
    expect(addresses.filter((address) => PROVIDER_HOSTS.test(address))).toEqual([]);
    // The poster reserves the player's 16:9 box, so loading it shifts nothing.
    expect(buttons[0]?.parentElement?.className).toContain('aspect-video');
  });

  it('loads the player after the click and moves focus into it', async () => {
    await renderPage(MINTLIFY_PAGE);
    const play = container.querySelector(PLAY);
    await act(async () => play?.click());
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1');
    expect(frame?.getAttribute('title')).toBe('YouTube video player');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation allow-popups');
    expect(frame?.getAttribute('allow')).toBe('encrypted-media; picture-in-picture; fullscreen');
    expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(frame?.getAttribute('loading')).toBe('lazy');
    expect(document.activeElement).toBe(frame);
    // Only the one the reader asked for.
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(container.querySelectorAll('[data-theme-component="video-embed"] button')).toHaveLength(1);
  });

  it('shows another site’s frame as a link card with its host, and other addresses as text', async () => {
    await renderPage(MINTLIFY_PAGE);
    const card = container.querySelector<HTMLAnchorElement>('a[data-theme-component="embed-link"]');
    expect(card?.getAttribute('href')).toBe('https://codepen.io/team/embed/abc');
    expect(card?.textContent).toBe('A pencodepen.io');
    expect(card?.hasAttribute('onload')).toBe(false);
    await renderPage('<iframe src="javascript:alert(1)" title="Bad"></iframe>');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Bad: javascript:alert(1)');
  });

  it('plays videos only on request, from secure addresses', async () => {
    await renderPage(MINTLIFY_PAGE);
    const videos = [...container.querySelectorAll('video')];
    expect(videos).toHaveLength(2);
    for (const video of videos) {
      expect(video.hasAttribute('controls')).toBe(true);
      expect(video.getAttribute('preload')).toBe('none');
      for (const name of ['autoplay', 'muted', 'loop']) expect(video.hasAttribute(name)).toBe(false);
    }
    expect(videos[0]?.getAttribute('src')).toBe('https://cdn.example.com/demo.mp4');
    await renderPage(
      '<video src="http://cdn.example.com/a.mp4" poster="http://cdn.example.com/p.png"><source src="http://cdn.example.com/a.webm" /></video>',
    );
    const insecure = container.querySelector('video');
    expect(insecure?.hasAttribute('src')).toBe(false);
    expect(insecure?.hasAttribute('poster')).toBe(false);
    expect(container.querySelector('source')?.hasAttribute('src')).toBe(false);
  });

  it('keeps a video’s caption tracks from secure addresses', async () => {
    await renderPage(
      '<video src="https://cdn.example.com/a.mp4"><track kind="captions" src="/captions/en.vtt" srclang="en" label="English" default /><track kind="subtitles" src="http://cdn.example.com/ar.vtt" srclang="ar" /></video>',
    );
    const [english, arabic] = [...container.querySelectorAll('track')];
    expect(english?.getAttribute('src')).toBe('/captions/en.vtt');
    expect(english?.getAttribute('srclang')).toBe('en');
    expect(english?.hasAttribute('default')).toBe(true);
    expect(arabic?.hasAttribute('src')).toBe(false);
  });

  it('names the control in Arabic and keeps the provider name left to right', async () => {
    await renderPage('<iframe src="https://vimeo.com/76979871" title="جولة في المنتج"></iframe>', 'ar');
    const play = container.querySelector(PLAY);
    expect(play?.getAttribute('aria-label')).toBe('تشغيل الفيديو: جولة في المنتج (يُحمَّل من Vimeo)');
    const provider = play?.querySelector('bdi');
    expect(provider?.getAttribute('dir')).toBe('ltr');
    expect(provider?.textContent).toBe('Vimeo');
    expect(play?.querySelector('[dir="auto"]')?.textContent).toBe('جولة في المنتج');
  });

  it('gives an untitled video a generic name', async () => {
    await renderPage('<iframe src="https://fast.wistia.net/embed/iframe/abc123def4"></iframe>');
    expect(container.querySelector(PLAY)?.getAttribute('aria-label')).toBe('Play video: Video (loads from Wistia)');
  });

  it('validates a hand-written reader element again', async () => {
    await act(async () => root.render(<VideoEmbed provider="youtube" videoid={'x" onload="y'} href="https://example.com/a" />));
    expect(container.querySelector(PLAY)).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a');
    await act(async () => root.render(<VideoEmbed provider="youtube" videoid="dQw4w9WgXcQ" start="1e9" />));
    await act(async () => container.querySelector(PLAY)?.click());
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1');
  });

  it('renders a link to the provider page without JavaScript', () => {
    const html = renderToString(<RichMarkdown content={MINTLIFY_PAGE} site={{ projectId: 'p', lang: 'en', defaultLanguage: 'en' }} />);
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('aria-label="Watch on YouTube: YouTube video player"');
    expect(html).toContain('href="https://www.loom.com/share/0123456789abcdef0123456789abcdef"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('data-provider="youtube"><button');
  });
});
