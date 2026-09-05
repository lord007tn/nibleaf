// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudPage, CopyCommand, GitHubStarLink, LandingPage } from '@/components/cloud-marketing';

describe('marketing calls to action', () => {
  it('uses destination-focused labels instead of generic prompts', () => {
    const landing = renderToStaticMarkup(<LandingPage stars={42} />);
    const cloud = renderToStaticMarkup(<CloudPage stars={42} />);

    expect(landing).toContain('Create account');
    expect(landing).toContain('Create free account');
    expect(landing).toContain('Compare options');
    expect(cloud).toContain('Create free account');
    expect(`${landing}${cloud}`).not.toContain('Get started');
    expect(`${landing}${cloud}`).not.toContain('Learn more');
  });
});

describe('GitHubStarLink', () => {
  it('keeps the repository link without presenting a cold or failed lookup as zero stars', () => {
    const html = renderToStaticMarkup(<GitHubStarLink stars={0} />);
    const fractionalHtml = renderToStaticMarkup(<GitHubStarLink stars={0.5} />);

    expect(html).toContain('href="https://github.com/lord007tn/nibleaf"');
    expect(html).toContain('aria-label="Star Nibleaf on GitHub"');
    expect(html).toContain('Star on GitHub');
    expect(html).not.toContain('data-github-stars');
    expect(fractionalHtml).not.toContain('data-github-stars');
  });

  it('rounds large counts like GitHub while retaining the exact accessible label', () => {
    const html = renderToStaticMarkup(<GitHubStarLink stars={1234} />);

    expect(html).toContain('aria-label="Star Nibleaf on GitHub — 1,234 stars"');
    expect(html).toContain('data-github-stars="1234"');
    expect(html).toContain('1.2k');
  });

  it('supports the compact GitHub header control without changing the repository destination', () => {
    const html = renderToStaticMarkup(<GitHubStarLink compact label="GitHub" stars={42} />);

    expect(html).toContain('href="https://github.com/lord007tn/nibleaf"');
    expect(html).toContain('aria-label="Star Nibleaf on GitHub — 42 stars"');
    expect(html).toContain('>GitHub</span>');
    expect(html).toContain('data-github-stars="42"');
  });
});

describe('CopyCommand', () => {
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
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('confirms a successful clipboard copy', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await act(async () => root.render(<CopyCommand command="echo ready" />));
    await act(async () => container.querySelector('button')?.click());

    expect(writeText).toHaveBeenCalledWith('echo ready');
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Copied');
    expect(container.textContent).toContain('Copied');
  });

  it('shows a clear error when the Clipboard API is unavailable', async () => {
    await act(async () => root.render(<CopyCommand command="echo ready" />));
    act(() => container.querySelector('button')?.click());

    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Copy failed');
    expect(container.textContent).toContain('Copy failed');
  });
});
