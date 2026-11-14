/** @vitest-environment jsdom */
/** The Ask AI shortcut (Ctrl/⌘+I) never takes keys from a reader who is typing. */
import { describe, expect, it } from 'vitest';
import { isAskAiShortcut } from './provider';

const press = (target: EventTarget, init: KeyboardEventInit) => {
  let seen: KeyboardEvent | undefined;
  const listener = (event: Event) => {
    seen = event as KeyboardEvent;
  };
  window.addEventListener('keydown', listener);
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'i', code: 'KeyI', ...init }));
  window.removeEventListener('keydown', listener);
  return seen as KeyboardEvent;
};

describe('isAskAiShortcut', () => {
  it('opens Ask AI from the page with Ctrl+I or ⌘+I, on any layout', () => {
    expect(isAskAiShortcut(press(document.body, { ctrlKey: true }))).toBe(true);
    expect(isAskAiShortcut(press(document.body, { metaKey: true }))).toBe(true);
    // An Arabic layout types another character on the same physical key.
    expect(isAskAiShortcut(press(document.body, { ctrlKey: true, key: 'ه' }))).toBe(true);
  });

  it('leaves the keys to text fields, text areas, selects and editable content', () => {
    for (const html of [
      '<input type="search">',
      '<textarea></textarea>',
      '<select><option>a</option></select>',
      '<div contenteditable="true"><span>x</span></div>',
    ]) {
      document.body.innerHTML = html;
      const field = document.body.firstElementChild?.querySelector('span') ?? document.body.firstElementChild;
      expect(isAskAiShortcut(press(field as Element, { ctrlKey: true }))).toBe(false);
    }
    document.body.replaceChildren();
  });

  it('ignores Shift, Alt (AltGr) and plain I', () => {
    expect(isAskAiShortcut(press(document.body, { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isAskAiShortcut(press(document.body, { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isAskAiShortcut(press(document.body, {}))).toBe(false);
  });
});
