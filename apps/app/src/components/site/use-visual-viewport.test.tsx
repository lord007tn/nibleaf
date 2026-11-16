// @vitest-environment jsdom
import type { CSSProperties, ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatViewport } from './ai-chat/use-chat-viewport';
import { useVisualViewport, type VisualViewportBox } from './use-visual-viewport';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/** A `visualViewport` whose size and offset a test moves, like a software keyboard would. */
class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  /** Moves the viewport and fires what browsers fire for it. */
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

let visual: FakeVisualViewport;
let root: Root | undefined;
let seen: VisualViewportBox | null | 'unrendered' = 'unrendered';
let chatStyle: CSSProperties | undefined;

function Probe({ active, retain }: { active: boolean; retain?: boolean }) {
  seen = useVisualViewport(active, retain);
  return null;
}

function ChatProbe({ open }: { open: boolean }) {
  chatStyle = useChatViewport(open);
  return null;
}

async function render(node: ReactNode) {
  if (!root) {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(node));
}

beforeEach(() => {
  visual = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  seen = 'unrendered';
  chatStyle = undefined;
  Reflect.deleteProperty(window, 'visualViewport');
  document.body.replaceChildren();
});

describe('useVisualViewport', () => {
  it('reads the visual viewport once active, and follows its resizes and scrolls', async () => {
    await render(<Probe active={false} />);
    expect(seen).toBeNull();
    await render(<Probe active />);
    expect(seen).toEqual({ height: 844, top: 0 });
    // The keyboard opens.
    await act(async () => visual.move({ height: 480 }));
    expect(seen).toEqual({ height: 480, top: 0 });
    // The browser pans the page under it.
    await act(async () => visual.move({ offsetTop: 120 }));
    expect(seen).toEqual({ height: 480, top: 120 });
  });

  it('stops listening when inactive, keeps the last reading while retained, and drops it after', async () => {
    const remove = vi.spyOn(visual, 'removeEventListener');
    await render(<Probe active />);
    await act(async () => visual.move({ height: 480, offsetTop: 40 }));
    await render(<Probe active={false} />);
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);
    // A closing sheet keeps its size while it animates out, whatever the keyboard does.
    await act(async () => visual.move({ height: 844, offsetTop: 0 }));
    expect(seen).toEqual({ height: 480, top: 40 });
    await render(<Probe active={false} retain={false} />);
    expect(seen).toBeNull();
    // The next opening reads the viewport afresh.
    await render(<Probe active />);
    expect(seen).toEqual({ height: 844, top: 0 });
  });

  it('removes its listeners when the caller unmounts', async () => {
    const add = vi.spyOn(visual, 'addEventListener');
    const remove = vi.spyOn(visual, 'removeEventListener');
    await render(<Probe active />);
    expect(add).toHaveBeenCalledTimes(2);
    await act(async () => root?.unmount());
    root = undefined;
    expect(remove.mock.calls).toEqual(add.mock.calls);
  });

  it('stays null without a visualViewport, so callers keep their dvh sizing', async () => {
    Reflect.deleteProperty(window, 'visualViewport');
    expect(window.visualViewport).toBeUndefined();
    await render(<Probe active />);
    expect(seen).toBeNull();
  });
});

describe("Ask AI's viewport, on the shared hook", () => {
  it('sets --chat-height and --chat-top from the visual viewport while open, and keeps them after close', async () => {
    await render(<ChatProbe open={false} />);
    expect(chatStyle).toEqual({});
    await render(<ChatProbe open />);
    expect(chatStyle).toEqual({ '--chat-height': '844px', '--chat-top': '0px' });
    await act(async () => visual.move({ height: 500, offsetTop: 30 }));
    expect(chatStyle).toEqual({ '--chat-height': '500px', '--chat-top': '30px' });
    // As before: the sheet keeps its last size while it slides out.
    await render(<ChatProbe open={false} />);
    await act(async () => visual.move({ height: 844 }));
    expect(chatStyle).toEqual({ '--chat-height': '500px', '--chat-top': '30px' });
  });

  it('is empty without a visualViewport', async () => {
    Reflect.deleteProperty(window, 'visualViewport');
    await render(<ChatProbe open />);
    expect(chatStyle).toEqual({});
  });
});
