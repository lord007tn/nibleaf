/** @vitest-environment jsdom */
/**
 * Overflowing tables and code blocks become named, keyboard-reachable regions
 * with an edge fade, and only while they overflow (PUB-001, PUB-005; axe
 * scrollable-region-focusable). jsdom does no layout, so each test states the
 * scroller's widths.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '@/components/markdown';
import { isProseCell, precedingHeadingText, scrollRegionProps } from '@/components/site/scroll-region';

const FENCE = '```';
const CONTENT = [
  '## Block components',
  '',
  '| Component | Purpose | Attributes |',
  '| --- | --- | --- |',
  '| `Tabs` | One tab per operating system | `title` |',
  '',
  '## Install',
  '',
  `${FENCE}bash title="install.sh"`,
  'curl -fsSL https://example.com/install.sh | sh -s -- --with-a-very-long-flag',
  FENCE,
  '',
  `${FENCE}json`,
  '{ "a": 1 }',
  FENCE,
].join('\n');

/** Layout the test controls: every element reports these widths. */
const layout = { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 };
let observers: Array<() => void> = [];
let frames: FrameRequestCallback[] = [];
/** Run the frames the scrollers asked for. */
const flushFrames = () =>
  act(() => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(0);
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const key of ['scrollWidth', 'clientWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => layout[key] });
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
    configurable: true,
    get: () => layout.scrollLeft,
    // Scrolling is the test's to state; writes are dropped.
    set: () => undefined,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.push(callback);
      }
      observe() {
        // The test calls the observers itself when it changes the layout.
      }
      disconnect() {
        observers = observers.filter((entry) => entry !== this.callback);
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  observers = [];
  frames = [];
  layout.scrollWidth = 0;
  layout.clientWidth = 0;
  layout.scrollLeft = 0;
});

function mount(content = CONTENT, lang = 'en') {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | undefined;
  act(() => {
    root = createRoot(host);
    root.render(<MarkdownRenderer content={content} site={{ projectId: 'docs', lang }} />);
  });
  return {
    host,
    unmount: () => {
      act(() => root?.unmount());
      host.remove();
    },
  };
}

describe('scroll regions', () => {
  it('server markup has no region attributes, so a fitting block stays out of the tab order', () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={CONTENT} site={{ projectId: 'docs', lang: 'en' }} />);
    expect(html).toContain('class="typeset-scroll"');
    // Heading anchors carry tabindex="-1"; nothing is focusable yet.
    expect(html).not.toMatch(/tabindex="0"|role="region"|data-scroll-region/);
  });

  it('leaves blocks that fit alone', () => {
    layout.scrollWidth = 600;
    layout.clientWidth = 600;
    const { host, unmount } = mount();
    expect(host.querySelectorAll('[tabindex="0"], [role="region"], [data-scroll-region]')).toHaveLength(0);
    unmount();
  });

  it('names an overflowing table after its section and an overflowing code block after its title or language', () => {
    layout.scrollWidth = 1546;
    layout.clientWidth = 734;
    const { host, unmount } = mount();
    const table = host.querySelector('.typeset-scroll');
    expect(table?.getAttribute('role')).toBe('region');
    expect(table?.getAttribute('tabindex')).toBe('0');
    expect(table?.getAttribute('aria-label')).toBe('Table: Block components');
    expect(table?.querySelector(':scope > table')).not.toBeNull();
    const [titled, untitled] = Array.from(host.querySelectorAll('pre'));
    expect(titled?.getAttribute('aria-label')).toBe('Code: install.sh');
    expect(untitled?.getAttribute('aria-label')).toBe('Code: json');
    expect(titled?.getAttribute('tabindex')).toBe('0');
    unmount();
  });

  it('fades only the edges where content waits, and follows the reader as they scroll', () => {
    layout.scrollWidth = 1000;
    layout.clientWidth = 500;
    const { host, unmount } = mount();
    const table = host.querySelector('.typeset-scroll') as HTMLElement;
    expect(table.hasAttribute('data-fade-start')).toBe(false);
    expect(table.hasAttribute('data-fade-end')).toBe(true);
    layout.scrollLeft = 250;
    table.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(table.hasAttribute('data-fade-start')).toBe(true);
    expect(table.hasAttribute('data-fade-end')).toBe(true);
    // A right-to-left scroller reports negative positions; the far end is -max.
    layout.scrollLeft = -500;
    table.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(table.hasAttribute('data-fade-start')).toBe(true);
    expect(table.hasAttribute('data-fade-end')).toBe(false);
    unmount();
  });

  it('drops the region once the block fits again (a wider window)', () => {
    layout.scrollWidth = 1000;
    layout.clientWidth = 500;
    const { host, unmount } = mount();
    expect(host.querySelector('.typeset-scroll')?.getAttribute('role')).toBe('region');
    layout.clientWidth = 1000;
    for (const callback of observers) callback();
    flushFrames();
    const table = host.querySelector('.typeset-scroll');
    expect(table?.hasAttribute('role')).toBe(false);
    expect(table?.hasAttribute('tabindex')).toBe(false);
    unmount();
  });

  it('names regions in the reader language', () => {
    layout.scrollWidth = 1000;
    layout.clientWidth = 500;
    const { host, unmount } = mount(['## المكونات', '', '| أ | ب |', '| --- | --- |', '| ١ | ٢ |'].join('\n'), 'ar');
    expect(host.querySelector('.typeset-scroll')?.getAttribute('aria-label')).toBe('جدول: المكونات');
    unmount();
  });
});

describe('scrollRegionProps', () => {
  it('adds nothing while the block fits', () => {
    expect(scrollRegionProps({ overflow: false, start: false, end: false }, 'Table')).toEqual({});
  });
});

describe('precedingHeadingText', () => {
  it('picks the last heading before the element within its article, not one after it', () => {
    document.body.innerHTML =
      '<h1>Page</h1><div class="typeset"><h2>First <a>#</a></h2><p>x</p><h3>Second</h3><div id="target"></div><h2>After</h2></div>';
    expect(precedingHeadingText(document.getElementById('target') as Element)).toBe('Second');
    document.body.innerHTML = '<h1>Page</h1><div class="typeset"><div id="target"></div><h2>After</h2></div>';
    expect(precedingHeadingText(document.getElementById('target') as Element)).toBeUndefined();
  });
});

describe('prose cells', () => {
  it('marks long running text, not identifiers or short values, in the server markup', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<MarkdownRenderer content={CONTENT} site={{ projectId: 'docs', lang: 'en' }} />);
    const cells = Array.from(host.querySelectorAll('tbody td'));
    expect(cells.map((cell) => cell.hasAttribute('data-cell-prose'))).toEqual([false, false, false]);
    host.innerHTML = renderToStaticMarkup(
      <MarkdownRenderer
        content={[
          '| Name | Purpose |',
          '| --- | --- |',
          '| `TIDEWATER_WEBHOOK_SECRET_FOR_STAGING` | Verifies the signature on every delivery. |',
        ].join('\n')}
        site={{ projectId: 'docs', lang: 'en' }}
      />,
    );
    expect(Array.from(host.querySelectorAll('tbody td')).map((cell) => cell.hasAttribute('data-cell-prose'))).toEqual([false, true]);
  });

  it('decides from the text inside formatting too', () => {
    const cell = {
      type: 'element' as const,
      tagName: 'td',
      properties: {},
      children: [
        { type: 'text' as const, value: 'Groups alternatives ' },
        { type: 'element' as const, tagName: 'strong', properties: {}, children: [{ type: 'text' as const, value: 'side by side, one per tab' }] },
      ],
    };
    expect(isProseCell(cell)).toBe(true);
    expect(isProseCell(undefined)).toBe(false);
  });
});
