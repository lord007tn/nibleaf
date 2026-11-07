import { describe, expect, it } from 'vitest';
import { isShortcutKey } from './site-keyboard';

describe('reader search shortcuts', () => {
  it('opens on Ctrl+K with an Arabic layout or Caps Lock on', () => {
    expect(isShortcutKey({ altKey: false, isComposing: false, key: 'k', code: 'KeyK' }, 'k', 'KeyK')).toBe(true);
    expect(isShortcutKey({ altKey: false, isComposing: false, key: 'K', code: 'KeyK' }, 'k', 'KeyK')).toBe(true);
    expect(isShortcutKey({ altKey: false, isComposing: false, key: 'ن', code: 'KeyK' }, 'k', 'KeyK')).toBe(true);
  });

  it('opens on "/" from the Arabic layout key that sits where "/" is', () => {
    expect(isShortcutKey({ altKey: false, isComposing: false, key: '/', code: 'Slash' }, '/', 'Slash')).toBe(true);
    expect(isShortcutKey({ altKey: false, isComposing: false, key: 'ظ', code: 'Slash' }, '/', 'Slash')).toBe(true);
  });

  it('follows Latin layouts that move the letter', () => {
    // Dvorak types "v" on the physical K key, and "k" elsewhere.
    expect(isShortcutKey({ altKey: false, isComposing: false, key: 'v', code: 'KeyK' }, 'k', 'KeyK')).toBe(false);
    expect(isShortcutKey({ altKey: false, isComposing: false, key: 'k', code: 'KeyV' }, 'k', 'KeyK')).toBe(true);
    // German types "-" on the physical slash key.
    expect(isShortcutKey({ altKey: false, isComposing: false, key: '-', code: 'Slash' }, '/', 'Slash')).toBe(false);
  });

  it('never treats AltGr, dead keys or an IME as the shortcut', () => {
    const base = { altKey: false, isComposing: false };
    // Windows AltGr is Ctrl+Alt: a Polish or Arabic-layout character typed on the K key.
    expect(isShortcutKey({ ...base, altKey: true, key: 'ĸ', code: 'KeyK' }, 'k', 'KeyK')).toBe(false);
    expect(isShortcutKey({ ...base, key: 'ن', code: 'KeyK', getModifierState: (name) => name === 'AltGraph' }, 'k', 'KeyK')).toBe(false);
    expect(isShortcutKey({ ...base, key: 'Dead', code: 'KeyK' }, 'k', 'KeyK')).toBe(false);
    expect(isShortcutKey({ ...base, key: 'Process', code: 'KeyK' }, 'k', 'KeyK')).toBe(false);
    expect(isShortcutKey({ ...base, isComposing: true, key: 'k', code: 'KeyK' }, 'k', 'KeyK')).toBe(false);
  });

  it('never opens on Alt+/ or an AltGr character, even when it is the shortcut character', () => {
    const base = { altKey: false, isComposing: false };
    expect(isShortcutKey({ ...base, altKey: true, key: '/', code: 'Slash' }, '/', 'Slash')).toBe(false);
    expect(isShortcutKey({ ...base, key: '/', code: 'Digit7', getModifierState: (name) => name === 'AltGraph' }, '/', 'Slash')).toBe(false);
    expect(isShortcutKey({ ...base, altKey: true, key: 'k', code: 'KeyK' }, 'k', 'KeyK')).toBe(false);
  });
});
