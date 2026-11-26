/** @vitest-environment jsdom */
/**
 * The fixed formatting toolbar ("Show formatting toolbar") works from the keyboard
 * as the selection menu does: one Tab stop, arrow keys along it (mirrored right to
 * left), Escape back to the text, and every button names its shortcut.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { TiptapEditor } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const cleanups: Array<() => Promise<void>> = [];
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
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mount(dir: 'ltr' | 'rtl' = 'ltr') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () => root.render(<TiptapEditor dir={dir} onChange={vi.fn()} value="Some text" variant="wysiwyg" />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const toolbar = container.querySelector<HTMLElement>('[role="toolbar"]');
  if (!toolbar) throw new Error('No toolbar');
  return { container, toolbar };
}
const buttons = (toolbar: HTMLElement) => [...toolbar.querySelectorAll<HTMLButtonElement>('button')];
const tabStops = (toolbar: HTMLElement) => buttons(toolbar).filter((button) => button.tabIndex === 0);
async function key(target: Element, name: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
}

describe('the fixed formatting toolbar', () => {
  it('is one Tab stop, on the first button that can be used', async () => {
    const { toolbar } = await mount();
    // Undo and Redo start disabled, so Heading 1 holds the stop.
    expect(tabStops(toolbar).map((button) => button.getAttribute('aria-label'))).toEqual(['editor.slash.h1.title (Ctrl+Alt+1)']);
  });

  it('moves with the arrow keys, Home and End, and remembers the last button', async () => {
    const { toolbar } = await mount();
    const [first] = tabStops(toolbar);
    await act(async () => first?.focus());
    await key(first as HTMLElement, 'ArrowRight');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('editor.slash.h2.title (Ctrl+Alt+2)');
    await key(document.activeElement as HTMLElement, 'End');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('editor.slash.codeBlock.title (Ctrl+Alt+C)');
    await key(document.activeElement as HTMLElement, 'ArrowRight');
    // Wraps to the first enabled button.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('editor.slash.h1.title (Ctrl+Alt+1)');
    await key(document.activeElement as HTMLElement, 'ArrowLeft');
    expect(tabStops(toolbar)).toEqual([document.activeElement]);
  });

  it('mirrors the arrow keys right to left', async () => {
    const { toolbar } = await mount('rtl');
    const [first] = tabStops(toolbar);
    await act(async () => first?.focus());
    await key(first as HTMLElement, 'ArrowLeft');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('editor.slash.h2.title (Ctrl+Alt+2)');
  });

  it('Escape returns to the text', async () => {
    const { toolbar, container } = await mount();
    const [first] = tabStops(toolbar);
    await act(async () => first?.focus());
    await key(first as HTMLElement, 'Escape');
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(container.querySelector('.ProseMirror')?.contains(document.activeElement)).toBe(true);
  });

  it('names each shortcut in the button label and tooltip', async () => {
    const { toolbar } = await mount();
    const labels = buttons(toolbar).map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(
      expect.arrayContaining(['editor.format.bold (Ctrl+B)', 'editor.slash.bulletList.title (Ctrl+Shift+8)', 'editor.format.link (Ctrl+K)']),
    );
    const bold = buttons(toolbar).find((button) => button.getAttribute('aria-label') === 'editor.format.bold (Ctrl+B)');
    expect(bold?.title).toBe('editor.format.bold (Ctrl+B)');
  });
});
