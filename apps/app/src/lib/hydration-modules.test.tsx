// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HydrationIsland } from '@/components/hydration-island';
import { HYDRATION_MODULE_ATTRIBUTE, HYDRATION_RETRY_DELAYS_MS, hydrationModule, loadServerRenderedModules } from './hydration-modules';

const markup = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('hydration modules', () => {
  it('renders a loaded module in the same pass, without suspending', async () => {
    const greeting = hydrationModule('greeting', async () => ({ Greeting: () => <p>Hello</p> }));
    await greeting.load();
    // No Suspense boundary: a suspension here would throw.
    const html = renderToStaticMarkup(
      <HydrationIsland modules={[greeting]}>
        {() => {
          const { Greeting } = greeting.read();
          return <Greeting />;
        }}
      </HydrationIsland>,
    );
    expect(html).toContain('<p>Hello</p>');
  });

  it('marks the markup it renders', () => {
    expect(hydrationModule('card', async () => null).marker).toEqual({ [HYDRATION_MODULE_ATTRIBUTE]: 'card' });
  });

  it('loads only the modules the server HTML was rendered with', async () => {
    const used = vi.fn(async () => 'used');
    const unused = vi.fn(async () => 'unused');
    await loadServerRenderedModules(markup(`<div ${HYDRATION_MODULE_ATTRIBUTE}="used"></div>`), async () => [
      hydrationModule('used', used),
      hydrationModule('unused', unused),
    ]);
    expect(used).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
  });

  it('does not load the declarations for a page without marked markup', async () => {
    const declarations = vi.fn(async () => []);
    await loadServerRenderedModules(markup('<main><p>Dashboard</p></main>'), declarations);
    expect(declarations).not.toHaveBeenCalled();
  });

  it('lets hydration go ahead when a download fails, leaving the module to retry', async () => {
    const flaky = hydrationModule('flaky', vi.fn<() => Promise<string>>().mockRejectedValue(new Error('chunk failed')));
    await expect(loadServerRenderedModules(markup(`<p ${HYDRATION_MODULE_ATTRIBUTE}="flaky"></p>`), async () => [flaky])).resolves.toBeUndefined();
    expect(flaky.status()).toBe('idle');
  });

  it('retries with backoff a bounded number of times, then only when asked', async () => {
    vi.useFakeTimers();
    const importer = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('chunk failed'));
    const flaky = hydrationModule('flaky', importer);
    await flaky.load().catch(() => undefined);
    const gaveUp = flaky.retry();
    expect(flaky.status()).toBe('loading');
    for (const delay of HYDRATION_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
    await expect(gaveUp).resolves.toBeUndefined();
    expect(importer).toHaveBeenCalledTimes(1 + HYDRATION_RETRY_DELAYS_MS.length);
    expect(flaky.status()).toBe('failed');
    // Giving up is final until the reader asks again.
    await expect(flaky.retry()).resolves.toBeUndefined();
    expect(importer).toHaveBeenCalledTimes(1 + HYDRATION_RETRY_DELAYS_MS.length);
    importer.mockResolvedValue('loaded');
    await expect(flaky.retry({ again: true })).resolves.toBe('loaded');
    expect(flaky.status()).toBe('loaded');
    expect(flaky.read()).toBe('loaded');
  });

  it('joins a download in flight instead of starting another', async () => {
    const importer = vi.fn(async () => 'loaded');
    const once = hydrationModule('once', importer);
    await Promise.all([once.load(), once.retry(), once.load()]);
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
