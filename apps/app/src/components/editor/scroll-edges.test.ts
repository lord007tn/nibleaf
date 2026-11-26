// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scrollEdges, scrollFadeStyle } from './scroll-edges';

/** A box with the given scroll geometry (jsdom has no layout). */
function box(geometry: Partial<Record<'scrollTop' | 'scrollHeight' | 'clientHeight' | 'scrollLeft' | 'scrollWidth' | 'clientWidth', number>>) {
  const element = document.createElement('div');
  for (const [key, value] of Object.entries(geometry)) Object.defineProperty(element, key, { value, configurable: true });
  return element;
}

describe('which edges of a scrolling list hide content', () => {
  it('says there is more below at the top of a long list, and more above at its end', () => {
    expect(scrollEdges(box({ scrollTop: 0, scrollHeight: 900, clientHeight: 500 }), 'y')).toEqual({ start: false, end: true });
    expect(scrollEdges(box({ scrollTop: 200, scrollHeight: 900, clientHeight: 500 }), 'y')).toEqual({ start: true, end: true });
    expect(scrollEdges(box({ scrollTop: 400, scrollHeight: 900, clientHeight: 500 }), 'y')).toEqual({ start: true, end: false });
  });

  it('says nothing for a list that fits', () => {
    expect(scrollEdges(box({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), 'y')).toEqual({ start: false, end: false });
  });

  it('reads a sideways row in reading order, right to left too (scrollLeft runs negative)', () => {
    expect(scrollEdges(box({ scrollLeft: 0, scrollWidth: 560, clientWidth: 350 }), 'x')).toEqual({ start: false, end: true });
    expect(scrollEdges(box({ scrollLeft: -210, scrollWidth: 560, clientWidth: 350 }), 'x')).toEqual({ start: true, end: false });
  });
});

describe('the fade at those edges', () => {
  it('fades only the edges that hide content', () => {
    expect(scrollFadeStyle({ start: false, end: false }, 'y')).toEqual({});
    expect(scrollFadeStyle({ start: false, end: true }, 'y').maskImage).toBe(
      'linear-gradient(to bottom, black, black calc(100% - var(--scroll-fade, 1.5rem)), transparent)',
    );
    expect(scrollFadeStyle({ start: true, end: false }, 'x').maskImage).toBe(
      'linear-gradient(to right, transparent, black var(--scroll-fade, 1.5rem), black)',
    );
  });

  it('runs a sideways fade from the start of the reading order, right to left', () => {
    expect(scrollFadeStyle({ start: false, end: true }, 'x', true).maskImage?.startsWith('linear-gradient(to left,')).toBe(true);
  });
});
