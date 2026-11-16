// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: mocks.search }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [value] }));

import { SiteSearch } from './site-search';
import { cancelSearchKeystrokes } from './site-search-keystrokes';

/*
 * On phones the search sheet fills the screen, with the '/' switch in a footer
 * under the results. Under the default viewport behaviour `dvh` doesn't shrink
 * for the software keyboard, so the sheet follows `visualViewport` instead
 * (use-visual-viewport.ts). jsdom applies no CSS, so these read the custom
 * properties the sheet's classes size and place it with.
 */

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/** A `visualViewport` a test moves, as a software keyboard opening or closing would. */
class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  move(next: { height?: number; offsetTop?: number }) {
    if (next.height !== undefined) {
      this.height = next.height;
      this.dispatchEvent(new Event('resize'));
    }
    if (next.offsetTop !== undefined) {
      this.offsetTop = next.offsetTop;
      this.dispatchEvent(new Event('scroll'));
    }
  }
}

const roots: Array<ReturnType<typeof createRoot>> = [];
let visual: FakeVisualViewport;

beforeAll(async () => {
  await import('./site-search-dialog');
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  mocks.search.mockReturnValue({ data: [], isFetching: false, error: null, refetch: vi.fn() });
  visual = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  cancelSearchKeystrokes();
  Reflect.deleteProperty(window, 'visualViewport');
  document.body.replaceChildren();
  vi.clearAllMocks();
});

type Props = Parameters<typeof SiteSearch>[0];

async function render(overrides: Partial<Props> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const props = { projectId: 'docs', open: true, lang: 'en', onOpenChange: vi.fn(), ...overrides };
  const rerender = async (next: Partial<Props> = {}) => {
    await act(async () => root.render(<SiteSearch {...props} {...next} />));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  };
  await rerender();
  return { root, rerender };
}

const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
/** The sheet's applied height and top, or null where it keeps its dvh fallback. */
const box = () => {
  const style = sheet()?.style;
  const height = style?.getPropertyValue('--search-height');
  const top = style?.getPropertyValue('--search-top');
  return height || top ? { height, top } : null;
};

describe('the phone search sheet follows the visual viewport', () => {
  it('sizes and places the sheet with the visual viewport, and follows the keyboard opening and closing', async () => {
    await render();
    expect(box()).toEqual({ height: '844px', top: '0px' });
    // The keyboard opens: the sheet ends where the keyboard begins.
    await act(async () => visual.move({ height: 470 }));
    expect(box()).toEqual({ height: '470px', top: '0px' });
    // iOS pans the page under the keyboard: the sheet moves with what's visible.
    await act(async () => visual.move({ offsetTop: 96 }));
    expect(box()).toEqual({ height: '470px', top: '96px' });
    // The keyboard closes.
    await act(async () => visual.move({ height: 844, offsetTop: 0 }));
    expect(box()).toEqual({ height: '844px', top: '0px' });
  });

  it('only phones use the size: wider screens keep their anchored panel', async () => {
    await render();
    const classes = sheet()?.classList;
    // Phones: the custom properties, with today's full-screen sheet as the fallback.
    expect(classes?.contains('h-[var(--search-height,100dvh)]')).toBe(true);
    expect(classes?.contains('top-[var(--search-top,0px)]')).toBe(true);
    expect(classes?.contains('h-dvh')).toBe(false);
    // From sm: the panel near the top of the screen, sized by its content.
    for (const token of ['sm:inset-auto', 'sm:top-[12vh]', 'sm:h-auto', 'sm:max-h-[min(76vh,680px)]']) {
      expect(classes?.contains(token), token).toBe(true);
    }
  });

  it('stops listening once search closes, and starts from a fresh reading when it opens again', async () => {
    const add = vi.spyOn(visual, 'addEventListener');
    const remove = vi.spyOn(visual, 'removeEventListener');
    const { rerender } = await render();
    await act(async () => visual.move({ height: 470, offsetTop: 96 }));
    expect(add.mock.calls.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);

    await rerender({ open: false });
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);
    expect(sheet()).toBeNull();

    // The keyboard went away while search was closed; nothing listened.
    visual.height = 844;
    visual.offsetTop = 0;
    await rerender({ open: true });
    expect(box()).toEqual({ height: '844px', top: '0px' });
  });

  it('drops its listeners when search unmounts while open', async () => {
    const add = vi.spyOn(visual, 'addEventListener');
    const remove = vi.spyOn(visual, 'removeEventListener');
    const { root } = await render();
    expect(add).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(remove.mock.calls).toEqual(add.mock.calls);
  });

  it('keeps the full-screen dvh sheet where there is no visualViewport', async () => {
    Reflect.deleteProperty(window, 'visualViewport');
    await render();
    expect(sheet()).not.toBeNull();
    expect(box()).toBeNull();
    expect(sheet()?.classList.contains('h-[var(--search-height,100dvh)]')).toBe(true);
  });
});
