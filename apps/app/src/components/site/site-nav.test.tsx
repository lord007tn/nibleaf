// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavNode } from '@/hooks/api';
import { isVersionIndependentNavNode, SiteNav } from './site-nav';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

const page = (id: string, children: NavNode[] = []): NavNode => ({ id, kind: 'PAGE', title: id, path: id, icon: null, tag: null, children });

const nav: NavNode[] = [page('guide', [page('install', [page('docker')]), page('configure')]), page('faq')];

async function renderNav(currentPath: string, dir: 'ltr' | 'rtl' = 'ltr') {
  const container = document.createElement('div');
  container.dir = dir;
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (path: string) =>
    act(async () => root.render(<SiteNav nodes={nav} projectId="docs" currentPath={path} toggleLabel="Toggle subpages" />));
  await render(currentPath);
  return { container, rerender: render };
}

const toggleFor = (container: HTMLElement, title: string) =>
  [...container.querySelectorAll('a')].find((anchor) => anchor.textContent === title)?.parentElement?.querySelector('button') ?? null;

const visibleTitles = (container: HTMLElement) => [...container.querySelectorAll('a')].map((anchor) => anchor.textContent);

describe('isVersionIndependentNavNode', () => {
  it('keeps synthetic OpenAPI navigation outside branch URL prefixes', () => {
    expect(isVersionIndependentNavNode({ id: 'openapi:hash' })).toBe(true);
    expect(isVersionIndependentNavNode({ id: 'page_123' })).toBe(false);
  });
});

describe('SiteNav page subtrees', () => {
  it('collapses pages with subpages unless the current page is inside them', async () => {
    const { container } = await renderNav('faq');
    expect(visibleTitles(container)).toEqual(['guide', 'faq']);
    expect(toggleFor(container, 'guide')?.getAttribute('aria-expanded')).toBe('false');
    expect(toggleFor(container, 'faq')).toBeNull();
  });

  it('expands every ancestor of a deeply nested current page', async () => {
    const { container } = await renderNav('docker');
    expect(visibleTitles(container)).toEqual(['guide', 'install', 'docker', 'configure', 'faq']);
    expect(toggleFor(container, 'guide')?.getAttribute('aria-expanded')).toBe('true');
    expect(toggleFor(container, 'install')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('expands a page that is itself current', async () => {
    const { container } = await renderNav('guide');
    expect(visibleTitles(container)).toEqual(['guide', 'install', 'configure', 'faq']);
  });

  it.each(['ltr', 'rtl'] as const)('toggles the subtree from a separate accessible button (%s)', async (dir) => {
    const { container } = await renderNav('faq', dir);
    const toggle = toggleFor(container, 'guide');
    const link = toggle?.parentElement?.querySelector('a');
    expect(toggle?.getAttribute('type')).toBe('button');
    expect(toggle?.getAttribute('aria-labelledby')).toBe(`${toggle?.id} ${link?.id}`);
    expect(toggle?.getAttribute('aria-label')).toBe('Toggle subpages');
    expect(toggle?.querySelector('svg')?.getAttribute('class')).toContain('rtl:-scale-x-100');

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle?.getAttribute('aria-controls') ?? '')?.tagName).toBe('UL');
    expect(visibleTitles(container)).toEqual(['guide', 'install', 'configure', 'faq']);

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle?.getAttribute('aria-controls') ?? '')).toBeNull();
  });

  it('opens the branch when navigation moves into it', async () => {
    const { container, rerender } = await renderNav('faq');
    await rerender('configure');
    expect(toggleFor(container, 'guide')?.getAttribute('aria-expanded')).toBe('true');
    expect(visibleTitles(container)).toContain('configure');
  });
});
