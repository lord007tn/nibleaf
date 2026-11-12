// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavNode } from '@/hooks/api';
import { isVersionIndependentNavNode, revealCurrentNavLink, SiteNav } from './site-nav';

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

// Collapsed subtrees stay in the DOM under a `hidden` list.
const visibleTitles = (container: HTMLElement) =>
  [...container.querySelectorAll('a')].filter((anchor) => !anchor.closest('[hidden]')).map((anchor) => anchor.textContent);

describe('isVersionIndependentNavNode', () => {
  it('keeps synthetic OpenAPI navigation outside branch URL prefixes', () => {
    expect(isVersionIndependentNavNode({ id: 'openapi:hash' })).toBe(true);
    expect(isVersionIndependentNavNode({ id: 'page_123' })).toBe(false);
  });
});

describe('SiteNav page subtrees', () => {
  it('omits empty groups, including nested empty groups, without grouping the following page', () => {
    const group = (id: string, children: NavNode[] = []): NavNode => ({ ...page(id, children), kind: 'GROUP' });
    const nodes = [group('Guides', [group('Empty nested group')]), page('Quickstart'), group('Reference', [page('API')])];
    const container = document.createElement('div');
    container.innerHTML = renderToString(<SiteNav nodes={nodes} projectId="docs" currentPath="Quickstart" toggleLabel="Toggle" />);
    expect(container.textContent).not.toContain('Guides');
    expect(container.textContent).not.toContain('Empty nested group');
    expect(container.textContent).toContain('Reference');
    const quickstart = container.querySelector('a');
    expect(quickstart?.textContent).toBe('Quickstart');
    expect(quickstart?.closest('ul')?.parentElement?.tagName).toBe('NAV');
  });

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
    expect(toggle?.querySelector('svg')?.getAttribute('class')).not.toContain('rotate-90');

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle?.getAttribute('aria-controls') ?? '')?.tagName).toBe('UL');
    expect(visibleTitles(container)).toEqual(['guide', 'install', 'configure', 'faq']);
    // Scale applies before rotation, so a mirrored chevron must turn the other way to point down.
    expect(toggle?.querySelector('svg')?.getAttribute('class')).toContain('rotate-90 rtl:-rotate-90');

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    const controlled = document.getElementById(toggle?.getAttribute('aria-controls') ?? '');
    expect(controlled?.tagName).toBe('UL');
    expect(controlled?.hidden).toBe(true);
  });

  it('keeps collapsed subpage links in the server HTML', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<SiteNav nodes={nav} projectId="docs" currentPath="faq" toggleLabel="Toggle subpages" />);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((anchor) => anchor.textContent)).toEqual(['guide', 'install', 'docker', 'configure', 'faq']);
    for (const anchor of links) expect(anchor.getAttribute('href')).toBeTruthy();
    expect(visibleTitles(container)).toEqual(['guide', 'faq']);

    const toggle = toggleFor(container, 'guide');
    const subtree = container.querySelector(`[id="${toggle?.getAttribute('aria-controls')}"]`);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(subtree?.tagName).toBe('UL');
    expect(subtree?.hasAttribute('hidden')).toBe(true);
    expect(subtree?.textContent).toContain('docker');
  });

  it('shows collapsed subpages to readers without JavaScript', () => {
    const html = renderToString(<SiteNav nodes={nav} projectId="docs" currentPath="faq" toggleLabel="Toggle subpages" />);
    expect(html).toContain('<noscript><style>@layer base{nav[data-site-nav] ul[hidden]{display:block!important}}</style></noscript>');
    expect(html.match(/<noscript>/g)).toHaveLength(1);
    expect(html).toContain('<nav data-site-nav="">');
  });

  it('opens the branch when navigation moves into it', async () => {
    const { container, rerender } = await renderNav('faq');
    await rerender('configure');
    expect(toggleFor(container, 'guide')?.getAttribute('aria-expanded')).toBe('true');
    expect(visibleTitles(container)).toContain('configure');
  });
});

const group = (id: string, children: NavNode[]): NavNode => ({ id, kind: 'GROUP', title: id, path: '', icon: null, tag: null, children });

describe('SiteNav sections', () => {
  const sections: NavNode[] = [group('Basics', [page('intro'), page('setup')]), group('Advanced', [page('tuning')])];

  it('reopens a collapsed top-level section when navigation enters it', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (path: string) =>
      act(async () => root.render(<SiteNav nodes={sections} projectId="docs" currentPath={path} toggleLabel="Toggle subpages" />));
    await render('intro');
    const advanced = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Advanced');
    await act(async () => advanced?.click());
    expect(advanced?.getAttribute('aria-expanded')).toBe('false');
    expect(visibleTitles(container)).not.toContain('tuning');

    await render('tuning');
    expect(advanced?.getAttribute('aria-expanded')).toBe('true');
    expect(visibleTitles(container)).toContain('tuning');
    // Navigating elsewhere leaves a section the reader collapsed alone.
    const basics = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Basics');
    await act(async () => basics?.click());
    await render('tuning');
    expect(basics?.getAttribute('aria-expanded')).toBe('false');
  });

  it('names the page list so it is distinct from the header links', () => {
    const html = renderToString(
      <SiteNav nodes={sections} projectId="docs" currentPath="intro" toggleLabel="Toggle subpages" label="Documentation pages" />,
    );
    expect(html).toContain('aria-label="Documentation pages"');
  });

  it('gives touch screens 44px rows and toggles', async () => {
    const { container } = await renderNav('faq');
    expect(toggleFor(container, 'guide')?.className).toContain('pointer-coarse:size-11');
    expect(container.querySelector('a')?.className).toContain('pointer-coarse:min-h-11');
  });
});

describe('revealCurrentNavLink', () => {
  const rect = (top: number, bottom: number) => ({
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });

  function layout(linkTop: number) {
    const viewport = document.createElement('div');
    viewport.style.overflowY = 'auto';
    const nav = document.createElement('nav');
    nav.innerHTML = '<a href="#a">a</a><a href="#b" aria-current="page">b</a>';
    viewport.append(nav);
    document.body.append(viewport);
    Object.defineProperty(viewport, 'scrollHeight', { value: 2000 });
    Object.defineProperty(viewport, 'clientHeight', { value: 400 });
    viewport.getBoundingClientRect = () => rect(100, 500) as DOMRect;
    const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (link) link.getBoundingClientRect = () => rect(linkTop, linkTop + 32) as DOMRect;
    return { viewport, nav };
  }

  it('scrolls only the nav viewport, by the least amount, when the current link is out of view', () => {
    const page = vi.spyOn(window, 'scrollTo');
    const { viewport, nav } = layout(900);
    viewport.scrollTop = 0;
    revealCurrentNavLink(nav);
    // 932 (link bottom) - 500 (viewport bottom) + 24 margin.
    expect(viewport.scrollTop).toBe(456);
    expect(page).not.toHaveBeenCalled();
  });

  it('leaves a visible current link where it is', () => {
    const { viewport, nav } = layout(200);
    viewport.scrollTop = 40;
    revealCurrentNavLink(nav);
    expect(viewport.scrollTop).toBe(40);
  });
});

// PUBLIC-22: long titles such as "Markdown and MDX components reference" wrap onto a
// second line instead of losing their end to an ellipsis, in every row kind.
describe('SiteNav long titles', () => {
  const long = 'Answer reader questions with AI search and chat';
  const tree: NavNode[] = [
    {
      id: 'section',
      kind: 'GROUP',
      title: `Section: ${long}`,
      path: 'section',
      icon: null,
      tag: null,
      children: [
        { id: 'sub', kind: 'GROUP', title: `Group: ${long}`, path: 'sub', icon: null, tag: null, children: [page('leaf')] },
        { ...page('ai'), title: `Page: ${long}`, tag: 'New' },
      ],
    },
  ];

  it('keeps the whole title and lets it wrap to two lines in sections, groups and pages', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<SiteNav nodes={tree} projectId="docs" currentPath="ai" toggleLabel="Toggle subpages" />);
    for (const prefix of ['Section', 'Group', 'Page']) {
      const label = [...container.querySelectorAll('span')].find((span) => span.textContent === `${prefix}: ${long}`);
      expect(label, prefix).toBeDefined();
      expect(label?.className).toContain('line-clamp-2');
      expect(label?.className).not.toContain('truncate');
    }
    expect(container.querySelector('.truncate')).toBeNull();
  });

  it('shows the whole title on hover or focus only when two lines are not enough', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<SiteNav nodes={tree} projectId="docs" currentPath="ai" toggleLabel="Toggle subpages" />));
    const labelFor = (prefix: string) =>
      [...container.querySelectorAll<HTMLElement>('[data-nav-label]')].find((span) => span.textContent === `${prefix}: ${long}`);
    // No tooltips until the reader points at a label: the server HTML has none.
    expect(container.querySelector('[data-nav-label][title]')).toBeNull();
    for (const prefix of ['Section', 'Group', 'Page']) {
      const label = labelFor(prefix);
      if (!label) throw new Error(`Missing ${prefix} label`);
      const control = label.closest('a, button') as HTMLElement;
      const name = control.textContent;
      // Clamped (jsdom has no layout, so the sizes are given): the whole title.
      Object.defineProperties(label, { scrollHeight: { configurable: true, value: 60 }, clientHeight: { configurable: true, value: 40 } });
      act(() => control.focus());
      expect(label.getAttribute('title'), prefix).toBe(`${prefix}: ${long}`);
      // Fits: no tooltip repeating what's on screen.
      act(() => control.blur());
      Object.defineProperties(label, { scrollHeight: { configurable: true, value: 40 } });
      act(() => control.focus());
      expect(label.hasAttribute('title'), prefix).toBe(false);
      // Keyboard focus shows no native tooltip, so the focused control's label unclamps instead.
      expect(label.className).toContain('in-focus-visible:line-clamp-none');
      expect(control.contains(label)).toBe(true);
      // The control's accessible name (its text) is unchanged.
      expect(control.textContent).toBe(name);
      expect(control.hasAttribute('title')).toBe(false);
    }
  });
});
