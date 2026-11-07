import { describe, expect, it } from 'vitest';
import { isShortcutKey } from './site-keyboard';

describe('reader search shortcuts', () => {
  it('opens on Ctrl+K with an Arabic layout or Caps Lock on', () => {
    expect(isShortcutKey({ key: 'k', code: 'KeyK' }, 'k', 'KeyK')).toBe(true);
    expect(isShortcutKey({ key: 'K', code: 'KeyK' }, 'k', 'KeyK')).toBe(true);
    expect(isShortcutKey({ key: 'ن', code: 'KeyK' }, 'k', 'KeyK')).toBe(true);
  });

  it('opens on "/" from the Arabic layout key that sits where "/" is', () => {
    expect(isShortcutKey({ key: '/', code: 'Slash' }, '/', 'Slash')).toBe(true);
    expect(isShortcutKey({ key: 'ظ', code: 'Slash' }, '/', 'Slash')).toBe(true);
  });

  it('follows Latin layouts that move the letter', () => {
    // Dvorak types "v" on the physical K key, and "k" elsewhere.
    expect(isShortcutKey({ key: 'v', code: 'KeyK' }, 'k', 'KeyK')).toBe(false);
    expect(isShortcutKey({ key: 'k', code: 'KeyV' }, 'k', 'KeyK')).toBe(true);
    // German types "-" on the physical slash key.
    expect(isShortcutKey({ key: '-', code: 'Slash' }, '/', 'Slash')).toBe(false);
  });
});
