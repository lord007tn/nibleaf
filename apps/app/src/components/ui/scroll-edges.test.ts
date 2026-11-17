import { describe, expect, it } from 'vitest';
import { edgeFadeMask, revealOffset, scrollEdges } from './scroll-edges';

describe('scrollEdges', () => {
  it('reports nothing hidden when the row fits', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300, rtl: false })).toEqual({ left: false, right: false });
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 301, clientWidth: 300, rtl: true })).toEqual({ left: false, right: false });
  });

  it('LTR: at the start only the right side hides content, at the end only the left', () => {
    const metrics = { scrollWidth: 600, clientWidth: 360, rtl: false };
    expect(scrollEdges({ ...metrics, scrollLeft: 0 })).toEqual({ left: false, right: true });
    expect(scrollEdges({ ...metrics, scrollLeft: 120 })).toEqual({ left: true, right: true });
    expect(scrollEdges({ ...metrics, scrollLeft: 240 })).toEqual({ left: true, right: false });
  });

  it('RTL: the start is the right edge, so at the start only the left side hides content', () => {
    const metrics = { scrollWidth: 600, clientWidth: 360, rtl: true };
    expect(scrollEdges({ ...metrics, scrollLeft: 0 })).toEqual({ left: true, right: false });
    expect(scrollEdges({ ...metrics, scrollLeft: -120 })).toEqual({ left: true, right: true });
    expect(scrollEdges({ ...metrics, scrollLeft: -240 })).toEqual({ left: false, right: true });
  });

  it('absorbs sub-pixel rounding at either end', () => {
    expect(scrollEdges({ scrollLeft: 239.5, scrollWidth: 600, clientWidth: 360, rtl: false })).toEqual({ left: true, right: false });
    expect(scrollEdges({ scrollLeft: 0.5, scrollWidth: 600, clientWidth: 360, rtl: false })).toEqual({ left: false, right: true });
  });
});

describe('edgeFadeMask', () => {
  it('has no mask when nothing is hidden', () => {
    expect(edgeFadeMask({ left: false, right: false })).toBeUndefined();
  });

  it('fades only the sides with hidden content', () => {
    expect(edgeFadeMask({ left: false, right: true })).toBe('linear-gradient(to right, #000 0, #000 calc(100% - 24px), transparent 100%)');
    expect(edgeFadeMask({ left: true, right: false }, 16)).toBe('linear-gradient(to right, transparent 0, #000 16px, #000 100%)');
    expect(edgeFadeMask({ left: true, right: true })).toBe(
      'linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)',
    );
  });
});

describe('revealOffset', () => {
  const row = { left: 0, right: 360 };

  it('does nothing before the row is laid out', () => {
    expect(revealOffset({ left: 0, right: 0 }, { left: 0, right: 0 })).toBe(0);
  });

  it('leaves a fully visible item alone', () => {
    expect(revealOffset({ left: 100, right: 200 }, row)).toBe(0);
  });

  it('scrolls right to reveal an item cut off at the right, with the inset to spare', () => {
    expect(revealOffset({ left: 320, right: 420 }, row)).toBe(84);
  });

  it('scrolls left (negative) to reveal an item cut off at the left', () => {
    expect(revealOffset({ left: -50, right: 40 }, row)).toBe(-74);
  });

  it('reduces the production inset so nearly row-wide tabs stay fully visible', () => {
    expect(revealOffset({ left: 20, right: 350 }, row, 40)).toBe(5);
    expect(revealOffset({ left: 10, right: 340 }, row, 40)).toBe(-5);
    expect(revealOffset({ left: 0, right: 360 }, row, 40)).toBe(0);
  });

  it('keeps the production inset when the tab has room on both sides', () => {
    expect(revealOffset({ left: 320, right: 420 }, row, 40)).toBe(100);
    expect(revealOffset({ left: -50, right: 40 }, row, 40)).toBe(-90);
  });
});
