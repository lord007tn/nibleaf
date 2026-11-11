// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HYDRATION_MODULE_ATTRIBUTE, hydrationModule, loadServerRenderedModules } from './hydration-modules';

const markup = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('hydration modules', () => {
  it('renders a loaded module in the same pass, without suspending', async () => {
    const greeting = hydrationModule('greeting', async () => ({ Greeting: () => <p>Hello</p> }));
    function Island() {
      const { Greeting } = greeting.useModule();
      return <Greeting />;
    }
    await greeting.load();
    // No Suspense boundary: a suspension here would throw.
    expect(renderToStaticMarkup(<Island />)).toBe('<p>Hello</p>');
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

  it('lets hydration go ahead when a download fails, and retries it later', async () => {
    const importer = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValue('loaded');
    const flaky = hydrationModule('flaky', importer);
    await expect(loadServerRenderedModules(markup(`<p ${HYDRATION_MODULE_ATTRIBUTE}="flaky"></p>`), async () => [flaky])).resolves.toBeUndefined();
    await expect(flaky.load()).resolves.toBe('loaded');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
