// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectTheme } from '@/lib/site-theme';
import { DocumentationReaderLayout, DocumentationThemeProvider } from './documentation-theme-provider';

const labels = { showAll: 'Show all', showLess: 'Show less' };
const theme = resolveProjectTheme({ theme: { preset: 'manuscript' } });
const links = Array.from({ length: 30 }, (_, index) => `Page ${index + 1}`);

const layout = (navigationLabels: typeof labels | undefined) => (
  <DocumentationThemeProvider context="reader" direction="ltr" theme={theme}>
    <DocumentationReaderLayout
      content={<main>article</main>}
      header={<header>header</header>}
      navigation={
        <nav>
          <ul>
            {links.map((link) => (
              <li key={link}>
                <a href={`/${link}`}>{link}</a>
              </li>
            ))}
          </ul>
        </nav>
      }
      navigationLabels={navigationLabels}
    />
  </DocumentationThemeProvider>
);

let resize: (() => void) | undefined;
let roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {
        // Sizes are given by the test, not observed.
      }
      disconnect() {
        resize = undefined;
      }
    },
  );
});
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** Mounts the layout; jsdom has no layout, so the index's sizes are given. */
const mount = async (contentHeight: number, navigationLabels?: typeof labels) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const sizes = { scrollHeight: contentHeight, clientHeight: 320 };
  const original = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => sizes.scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => sizes.clientHeight });
  await act(async () => root.render(layout(navigationLabels)));
  await act(async () => resize?.());
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original.scrollHeight ?? { configurable: true, value: 0 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.clientHeight ?? { configurable: true, value: 0 });
  const index = container.querySelector<HTMLElement>('.documentation-manuscript-navigation');
  if (!index) throw new Error('Missing navigation index');
  return { container, index, toggle: () => container.querySelector<HTMLButtonElement>('[data-theme-region="nav-toggle"]') };
};

describe('Manuscript navigation index (#536)', () => {
  it('keeps every link in the server HTML, collapsed, with no control until it is known to overflow', () => {
    const html = renderToString(layout(labels));
    for (const link of links) expect(html).toContain(`>${link}</a>`);
    expect(html).toContain('data-collapsed=""');
    expect(html).not.toContain('data-theme-region="nav-toggle"');
  });

  it('says when the index is cut, and shows the rest on request', async () => {
    const { index, toggle } = await mount(900, labels);
    expect(index.hasAttribute('data-overflows')).toBe(true);
    expect(toggle()?.textContent).toBe('Show all');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle()?.getAttribute('aria-controls')).toBe(index.id);

    await act(async () => toggle()?.click());
    expect(index.hasAttribute('data-collapsed')).toBe(false);
    expect(index.hasAttribute('data-overflows')).toBe(false);
    expect(toggle()?.textContent).toBe('Show less');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => toggle()?.click());
    expect(index.hasAttribute('data-collapsed')).toBe(true);
    expect(toggle()?.textContent).toBe('Show all');
  });

  it('adds nothing when the whole index fits, or when no labels are given', async () => {
    expect((await mount(200, labels)).toggle()).toBeNull();
    expect((await mount(900, undefined)).toggle()).toBeNull();
  });

  it('opens in full without JavaScript: the server HTML lifts the collapse with a no-script rule', () => {
    const html = renderToString(layout(labels));
    expect(html).toContain(
      '<noscript><style>.documentation-manuscript-navigation[data-collapsed]{max-block-size:none;overflow:visible}</style></noscript>',
    );
    // The rule it lifts sits in a cascade layer, so the unlayered no-script rule wins.
    const css = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8');
    const layer = css.slice(css.lastIndexOf('@layer components {', css.indexOf('.documentation-manuscript-navigation[data-collapsed] {')));
    expect(layer.startsWith('@layer components {')).toBe(true);
    expect(layer).toMatch(/\.documentation-manuscript-navigation\[data-collapsed\] \{\s*max-block-size: min\(35dvh, 20rem\);\s*overflow: hidden;/);
  });

  it('keeps the same button, and its focus, when the index is folded again', async () => {
    const { index, toggle } = await mount(900, labels);
    const button = toggle();
    await act(async () => {
      button?.focus();
      button?.click();
    });
    // Expanded, everything fits: a new measurement must not take the button away.
    Object.defineProperty(index, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(index, 'clientHeight', { configurable: true, value: 900 });
    await act(async () => resize?.());
    expect(toggle()).toBe(button);
    await act(async () => button?.click());
    expect(toggle()).toBe(button);
    expect(button?.textContent).toBe('Show all');
    expect(document.activeElement).toBe(button);
  });

  it('opens the whole index when a keyboard reaches a link inside the fade at its end', async () => {
    const { container, index } = await mount(900, labels);
    const link = [...container.querySelectorAll('a')][10] as HTMLElement;
    index.getBoundingClientRect = () => ({ top: 0, bottom: 320 }) as DOMRect;
    // Ends 2px above the bottom: inside the 4rem fade, not below the index.
    link.getBoundingClientRect = () => ({ top: 298, bottom: 318 }) as DOMRect;
    await act(async () => link.focus());
    expect(index.hasAttribute('data-collapsed')).toBe(false);
  });

  it('opens the whole index when a keyboard reaches a link below the visible part', async () => {
    const { container, index, toggle } = await mount(900, labels);
    const last = [...container.querySelectorAll('a')].at(-1) as HTMLElement;
    index.getBoundingClientRect = () => ({ top: 0, bottom: 320 }) as DOMRect;
    last.getBoundingClientRect = () => ({ top: 860, bottom: 880 }) as DOMRect;
    await act(async () => last.focus());
    expect(index.hasAttribute('data-collapsed')).toBe(false);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  });
});
