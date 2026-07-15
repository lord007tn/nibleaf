import { describe, expect, it } from 'vitest';
import { nextSlashSelection, resolveSlashAnchor, shouldHandleSlashTrigger, slashTriggerOffset } from './extensions/slash-command';

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

  it('captures slash only where a command palette can start', () => {
    expect(shouldHandleSlashTrigger('')).toBe(true);
    expect(shouldHandleSlashTrigger(' ')).toBe(true);
    expect(shouldHandleSlashTrigger('a')).toBe(false);
    expect(shouldHandleSlashTrigger('/')).toBe(false);
  });

  it('tracks the complete active slash query', () => {
    expect(slashTriggerOffset('/')).toBe(0);
    expect(slashTriggerOffset('/hea')).toBe(0);
    expect(slashTriggerOffset('hello /hea')).toBe(6);
    expect(slashTriggerOffset('hello/hea')).toBeNull();
    expect(slashTriggerOffset('/heading one')).toBeNull();
    expect(slashTriggerOffset('//hea')).toBeNull();
  });

  it('positions on the first slash transaction before the decoration commits', () => {
    const cursor = { left: 120, right: 121, top: 240, bottom: 260 };
    const coordsAtPos = (position: number) => {
      expect(position).toBe(7);
      return cursor;
    };

    expect(resolveSlashAnchor(() => null, coordsAtPos, 7)).toEqual(cursor);
  });
});
