// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { findMainContent, SkipToContent, skipToMainContent } from './skip-to-content';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('skip to main content', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const page = (html: string) => {
    const shell = document.createElement('div');
    shell.innerHTML = html;
    document.body.append(shell);
  };

  it('focuses the layout content wrapper first', async () => {
    page('<nav><a href="/">Sites</a></nav><main><div id="main-content">Dashboard</div></main>');
    await act(async () => root.render(<SkipToContent />));
    await act(async () => container.querySelector('button')?.click());

    const target = document.getElementById('main-content');
    expect(document.activeElement).toBe(target);
    expect(target?.getAttribute('tabindex')).toBe('-1');
  });

  it('lands on a screen-marked content region when the screen renders without the layouts (editor)', () => {
    page('<aside><button>Pages</button></aside><header><button>Publish</button></header><section data-main-content>Canvas</section>');
    expect(skipToMainContent()).toBe(true);
    expect(document.activeElement?.textContent).toBe('Canvas');
  });

  it('falls back to the main landmark and keeps an existing tabindex', () => {
    page('<main tabindex="0">Content</main>');
    expect(findMainContent()?.tagName).toBe('MAIN');
    skipToMainContent();
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
  });

  it('skips hidden targets', () => {
    page('<div hidden><div id="main-content">Closed</div></div><div role="main">Open</div>');
    expect(findMainContent()?.textContent).toBe('Open');
  });

  it('reports when the screen has no content target', () => {
    page('<nav>Only chrome</nav>');
    expect(skipToMainContent()).toBe(false);
  });
});
