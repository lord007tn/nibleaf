import { describe, expect, it } from 'vitest';
import { nextSlashSelection } from './extensions/slash-command';

describe('slash command keyboard selection', () => {
  it('wraps arrow navigation and supports Home/End', () => {
    expect(nextSlashSelection(0, 3, 'ArrowUp')).toBe(2);
    expect(nextSlashSelection(2, 3, 'ArrowDown')).toBe(0);
    expect(nextSlashSelection(1, 3, 'Home')).toBe(0);
    expect(nextSlashSelection(1, 3, 'End')).toBe(2);
  });

  it('does not select from an empty list or consume unrelated keys', () => {
    expect(nextSlashSelection(0, 0, 'ArrowDown')).toBeNull();
    expect(nextSlashSelection(0, 3, 'Escape')).toBeNull();
  });
});
