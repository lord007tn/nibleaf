// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slashMenuPlacement, visibleArea } from './extensions/slash-command';

/*
 * The "/" menu is placed in the part of the page the writer can see. On a phone
 * the on-screen keyboard shrinks only the visual viewport, so a menu placed by
 * window.innerHeight opened under the keyboard (#962).
 */
const menu = { width: 300, height: 400 };
// A 390 × 844 phone with the keyboard open: 500 px left visible above it.
const keyboardOpen = { left: 0, top: 0, width: 390, height: 500 };

afterEach(() => vi.unstubAllGlobals());

describe('placing the "/" menu', () => {
  it('opens below the "/" when it fits', () => {
    const placed = slashMenuPlacement({ left: 20, right: 30, top: 40, bottom: 60 }, menu, { left: 0, top: 0, width: 1440, height: 900 }, false);
    expect(placed).toEqual({ left: 20, top: 66, maxHeight: 900 - 12 - 66 });
  });

  it('opens above the "/" when the keyboard leaves no room below', () => {
    // The "/" sits just above the keyboard.
    const placed = slashMenuPlacement({ left: 20, right: 30, top: 440, bottom: 460 }, menu, keyboardOpen, false);
    expect(placed.top + Math.min(menu.height, placed.maxHeight)).toBeLessThanOrEqual(440);
    expect(placed.top).toBeGreaterThanOrEqual(12);
  });

  it('takes the side with more room, and limits its height to it, when it fits on neither', () => {
    const placed = slashMenuPlacement({ left: 20, right: 30, top: 200, bottom: 220 }, menu, keyboardOpen, false);
    // 182 px above, 262 px below: below, scrolling inside 262 px.
    expect(placed.top).toBe(226);
    expect(placed.maxHeight).toBe(500 - 12 - 226);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(500);
  });

  it('stays inside the visible area sideways, aligned to the "/" right to left', () => {
    const placed = slashMenuPlacement({ left: 360, right: 370, top: 40, bottom: 60 }, menu, keyboardOpen, true);
    expect(placed.left).toBe(70);
    const clamped = slashMenuPlacement({ left: 380, right: 388, top: 40, bottom: 60 }, menu, keyboardOpen, false);
    expect(clamped.left).toBe(390 - 300 - 12);
  });

  it('follows a visual viewport scrolled within the page (keyboard open, page pushed up)', () => {
    const scrolled = { left: 0, top: 300, width: 390, height: 500 };
    const placed = slashMenuPlacement({ left: 20, right: 30, top: 700, bottom: 720 }, menu, scrolled, false);
    expect(placed.top).toBeGreaterThanOrEqual(312);
    expect(placed.top + Math.min(menu.height, placed.maxHeight)).toBeLessThanOrEqual(700);
  });

  it('reads the visible area from the visual viewport where there is one', () => {
    vi.stubGlobal('visualViewport', { offsetLeft: 0, offsetTop: 120, width: 390, height: 480 });
    expect(visibleArea()).toEqual({ left: 0, top: 120, width: 390, height: 480 });
    vi.stubGlobal('visualViewport', undefined);
    expect(visibleArea()).toEqual({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
  });
});
