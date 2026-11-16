// @vitest-environment jsdom
import type { CSSProperties, ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The search sheet keeps its visual-viewport size until its exit animation has
 * finished (use-visual-viewport.ts). jsdom has no animations, so Base UI would
 * report each open and close as complete straight away. This replaces the
 * dialog with one that stays mounted and hands the test its completion
 * callback, so the test decides when each animation finishes.
 */

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  dialog: { onOpenChangeComplete: undefined as ((open: boolean) => void) | undefined },
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: mocks.search }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [value] }));
vi.mock('@nibleaf/design-system/components/ui/dialog', () => ({
  Dialog: ({ children, onOpenChangeComplete }: { children: ReactNode; onOpenChangeComplete?: (open: boolean) => void }) => {
    mocks.dialog.onOpenChangeComplete = onOpenChangeComplete;
    return children;
  },
  DialogContent: ({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) => (
    <div role="dialog" className={className} style={style}>
      {children}
    </div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

import { SiteSearch } from './site-search';
import { cancelSearchKeystrokes } from './site-search-keystrokes';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  resize(height: number) {
    this.height = height;
    this.dispatchEvent(new Event('resize'));
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
  mocks.dialog.onOpenChangeComplete = undefined;
  vi.clearAllMocks();
});

async function render() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const props = { projectId: 'docs', lang: 'en', onOpenChange: vi.fn() };
  const show = async (open: boolean) => {
    await act(async () => root.render(<SiteSearch {...props} open={open} />));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  };
  return { show };
}

/** Base UI reporting that the open or close animation has finished. */
const finish = (open: boolean) =>
  act(async () => {
    const complete = mocks.dialog.onOpenChangeComplete;
    if (!complete) throw new Error('The dialog was given no onOpenChangeComplete');
    complete(open);
  });

const height = () => document.querySelector<HTMLElement>('[role="dialog"]')?.style.getPropertyValue('--search-height') || null;

describe('the phone search sheet through its exit animation', () => {
  it('keeps its size while animating out, then drops it', async () => {
    const { show } = await render();
    await show(true);
    await finish(true);
    await act(async () => visual.resize(470));
    await show(false);
    expect(height()).toBe('470px');
    await finish(false);
    expect(height()).toBeNull();
  });

  it('keeps its size when a close interrupts the opening animation after an earlier close', async () => {
    const { show } = await render();
    // A first visit to search, opened and closed all the way.
    await show(true);
    await finish(true);
    await show(false);
    await finish(false);

    // Search opens again, the keyboard comes up, and the reader closes it
    // before the opening animation has finished (Base UI drops that completion).
    await show(true);
    await act(async () => visual.resize(470));
    expect(height()).toBe('470px');
    await show(false);
    expect(height()).toBe('470px');
    await finish(false);
    expect(height()).toBeNull();
  });
});
