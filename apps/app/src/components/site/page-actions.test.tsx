/** @vitest-environment jsdom */
/**
 * Page actions for people and AI tools (PUB-018): copy the page's Markdown twin,
 * view it, or open it in ChatGPT or Claude.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askAiLinks, PageActions, pageMarkdownHref } from '@/components/site/page-actions';

describe('pageMarkdownHref', () => {
  it('points at the Markdown twin and keeps the language and version', () => {
    expect(pageMarkdownHref('/sites/docs/guides/webhooks')).toBe('/sites/docs/guides/webhooks.md');
    expect(pageMarkdownHref('/guides/webhooks?lang=ar')).toBe('/guides/webhooks.md?lang=ar');
    // A custom domain's home page has its own twin.
    expect(pageMarkdownHref('/')).toBe('/_index.md');
    expect(pageMarkdownHref('/?lang=ar&version=v2')).toBe('/_index.md?lang=ar&version=v2');
  });
});

describe('askAiLinks', () => {
  it('hands the absolute Markdown URL to ChatGPT and Claude in an encoded prompt', () => {
    const links = askAiLinks('https://docs.example.com/guides/webhooks.md?lang=ar');
    for (const href of [links.chatgpt, links.claude]) {
      const prompt = new URL(href).searchParams.get('q');
      expect(prompt).toBe('Read https://docs.example.com/guides/webhooks.md?lang=ar so I can ask questions about it.');
    }
    expect(new URL(links.chatgpt).origin).toBe('https://chatgpt.com');
    expect(new URL(links.claude).origin).toBe('https://claude.ai');
  });
});

describe('PageActions', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('server-renders a labelled split button, hidden in print, in the reader language', () => {
    const html = renderToStaticMarkup(<PageActions pageHref="/guides/webhooks" lang="ar" />);
    const host = document.createElement('div');
    host.innerHTML = html;
    const [copy, menu] = Array.from(host.querySelectorAll('button'));
    expect(copy?.textContent).toBe('نسخ الصفحة');
    expect(menu?.getAttribute('aria-label')).toBe('إجراءات أخرى للصفحة');
    expect(menu?.getAttribute('aria-haspopup')).toBe('menu');
    expect(host.firstElementChild?.className).toContain('print:hidden');
    // 44px wide on touch screens, like its height.
    expect(menu?.className).toContain('pointer-coarse:min-w-11');
  });

  it('carries the reader language and direction it is given (a fallback page)', () => {
    const html = renderToStaticMarkup(<PageActions pageHref="/guides/webhooks" lang="ar" attributes={{ lang: 'ar', dir: 'rtl' }} />);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.firstElementChild?.getAttribute('lang')).toBe('ar');
    expect(host.firstElementChild?.getAttribute('dir')).toBe('rtl');
  });

  it('copies the Markdown twin and says so through the shared live region', async () => {
    const fetch = vi.fn(async () => new Response('# Webhooks\n', { status: 200 }));
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', fetch);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<PageActions pageHref="/guides/webhooks?lang=en" lang="en" />));
    await act(async () => host.querySelector('button')?.click());
    expect(fetch).toHaveBeenCalledWith('/guides/webhooks.md?lang=en', expect.objectContaining({ headers: { accept: 'text/markdown' } }));
    expect(writeText).toHaveBeenCalledWith('# Webhooks\n');
    await vi.waitFor(() => expect(document.querySelector('[data-reader-announcer]')?.textContent).toBe('Page copied as Markdown'));
    act(() => root.unmount());
  });

  it('lets the newest copy win: an earlier, slower copy never overwrites it', async () => {
    // Responses arrive when the test says, and this fetch ignores abort, so the
    // guard after the response is what keeps page A off the clipboard.
    const responses = new Map<string, (body: string) => void>();
    const fetch = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          responses.set(url, (body) => resolve(new Response(body, { status: 200 })));
        }),
    );
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', fetch);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    // Copy page A, move to page B (the same component, a new href), copy B.
    await act(async () => root.render(<PageActions pageHref="/guides/a" lang="en" />));
    await act(async () => host.querySelector('button')?.click());
    await act(async () => root.render(<PageActions pageHref="/guides/b" lang="en" />));
    await act(async () => host.querySelector('button')?.click());
    // A's request was aborted when B's began.
    const [, firstInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstInit.signal?.aborted).toBe(true);
    // B answers first, then A's stale response arrives anyway.
    await act(async () => responses.get('/guides/b.md')?.('# B\n'));
    await act(async () => responses.get('/guides/a.md')?.('# A\n'));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('# B\n');
    act(() => root.unmount());
  });

  it('says when the page could not be copied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<PageActions pageHref="/missing" lang="en" />));
    await act(async () => host.querySelector('button')?.click());
    await vi.waitFor(() => expect(document.querySelector('[data-reader-announcer]')?.textContent).toMatch(/^Couldn.t copy the page/));
    act(() => root.unmount());
  });
});
