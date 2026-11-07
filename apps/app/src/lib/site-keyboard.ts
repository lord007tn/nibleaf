/**
 * Whether a keyboard event is the reader shortcut `key` (`'k'`, `'/'`).
 *
 * `event.key` is the character the layout typed: it follows Dvorak or AZERTY,
 * but reads "ن" for Ctrl+K on an Arabic layout and "K" under Caps Lock. So the
 * character matches case-insensitively, and the physical key (`event.code`)
 * stands in only when the layout typed a non-Latin character there.
 */
export const isShortcutKey = (event: Pick<KeyboardEvent, 'key' | 'code'>, key: string, code: string): boolean => {
  if (event.key.toLowerCase() === key) return true;
  return event.code === code && !/^[ -~]$/u.test(event.key);
};
