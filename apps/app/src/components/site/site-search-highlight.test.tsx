// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Highlight, highlightParts } from './site-search-highlight';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const marked = (text: string, query: string) =>
  highlightParts(text, query)
    .filter((part) => part.marked)
    .map((part) => part.value);

afterEach(() => {
  document.body.replaceChildren();
});

describe('search highlighting', () => {
  it('marks every query word, ignoring case, and keeps the published text', () => {
    expect(marked('Cancel a Reservation', 'cancel RESERVATION')).toEqual(['Cancel', 'Reservation']);
    expect(
      highlightParts('Cancel a Reservation', 'cancel')
        .map((part) => part.value)
        .join(''),
    ).toBe('Cancel a Reservation');
  });

  it('marks nothing for an empty or one-letter query', () => {
    expect(marked('Cancel a reservation', '')).toEqual([]);
    expect(marked('Cancel a reservation', 'c')).toEqual([]);
  });

  it.each([
    // Tashkeel (diacritics) in the text or the query.
    ['إِلْغَاءُ الحجز', 'الغاء', 'إِلْغَاءُ'],
    ['الغاء الحجز', 'إِلْغَاء', 'الغاء'],
    // Tatweel stretches a word without changing it.
    ['الحـــجز مؤكد', 'الحجز', 'الحـــجز'],
    // Alef forms أ إ آ fold to ا.
    ['أسعار الغرف', 'اسعار', 'أسعار'],
    ['آخر موعد', 'اخر', 'آخر'],
    // Alef maqsura ى and yaa ي match each other.
    ['مستشفى المدينة', 'مستشفي', 'مستشفى'],
    // Taa marbuta ة and haa ه match each other.
    ['سياسة الإلغاء', 'سياسه', 'سياسة'],
    ['سياسه الإلغاء', 'سياسة', 'سياسه'],
  ])('folds Arabic in %s for the query %s', (text, query, expected) => {
    expect(marked(text, query)).toContain(expected);
  });

  it('renders markup in titles and snippets as text, never as HTML', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const snippet = 'Use <b>cancel</b> & <img src=x onerror="alert(1)"> to cancel';
    await act(async () => root.render(<Highlight text={snippet} query="cancel" />));
    expect(container.querySelector('b, img, script')).toBeNull();
    expect(container.textContent).toBe(snippet);
    expect([...container.querySelectorAll('mark')].map((node) => node.textContent)).toEqual(['cancel', 'cancel']);
    expect(container.innerHTML).toContain('&lt;img src=x onerror="alert(1)"&gt;');
    await act(async () => root.unmount());
  });

  it('marks a query that looks like markup as plain text', () => {
    expect(marked('Wrap it in <mark> tags', '<mark>')).toEqual(['<mark>']);
  });
});
