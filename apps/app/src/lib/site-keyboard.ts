type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'isComposing'> & { getModifierState?: (key: string) => boolean };

/**
 * Whether a keyboard event is the reader shortcut `key` (`'k'`, `'/'`).
 *
 * `event.key` is the character the layout typed: it follows Dvorak or AZERTY,
 * but reads "ن" for Ctrl+K on an Arabic layout and "K" under Caps Lock. So the
 * character matches case-insensitively, and the physical key (`event.code`)
 * stands in only when the layout typed one non-Latin character there. Never
 * with Alt or AltGr held (Windows reports AltGr as Ctrl+Alt), a dead key or an
 * IME, where the reader is typing a character, not asking for search.
 */
export const isShortcutKey = (event: ShortcutEvent, key: string, code: string): boolean => {
  if (event.isComposing || event.key === 'Dead' || event.key === 'Process') return false;
  if (event.altKey || event.getModifierState?.('AltGraph')) return false;
  if (event.key.toLowerCase() === key) return true;
  return event.key.length === 1 && event.code === code && !/^[ -~]$/u.test(event.key);
};
