// @vitest-environment jsdom
import { searchQuery } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The real dialog, query hook and transport, with only the public API faked.
// The fake validates `q` with the API's own `searchQuery` schema and answers
// an over-long query the way the server does (HTTP 422, `validation:failed`),
// so a query the browser lets through over the limit shows up as the dialog's
// error state, as it did for readers before #842.
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { public: { sites: { ':id': { search: { $get: mocks.get } } } } } }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock('@/providers/site-analytics-provider', () => ({
  useSiteAnalytics: () => ({ track: vi.fn() }),
  getSiteSearchAnalytics: () => ({ consentState: 'unknown' }),
}));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [value] }));

import { beginSearchKeystrokes, cancelSearchKeystrokes } from './site-search-keystrokes';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const hit = { id: 'setup', path: 'setup', title: 'Setup guide', snippet: 'Configure the project.', language: 'en', icon: null };
const EMOJI = '😀'; // two UTF-16 units, one code point
const ARABIC = 'ب';
const codePoints = (value: string) => [...value].length;
const hasLoneSurrogate = (value: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

let root: Root | undefined;
let client: QueryClient;
let SiteSearchDialog: typeof import('./site-search-dialog').default;

beforeAll(async () => {
  ({ default: SiteSearchDialog } = await import('./site-search-dialog'));
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.get.mockImplementation(async ({ query }: { query: { q: string } }) =>
    searchQuery.safeParse({ q: query.q }).success
      ? Response.json({ data: { hits: [hit], searchId: 'search-1' } })
      : Response.json({ error: { code: 'validation:failed', message: 'Validation failed' } }, { status: 422 }),
  );
  // Model a supported native edit for value/state checks. Real undo and
  // selection restoration are checked by the browser regression.
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn((_command: string, _showUi: boolean, text: string) => {
      const field = input();
      if (!field) return false;
      field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return true;
    }),
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  cancelSearchKeystrokes();
  document.body.replaceChildren();
  vi.clearAllMocks();
  Reflect.deleteProperty(document, 'execCommand');
});

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const until = async (ready: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !ready(); attempt += 1) await settle();
};

async function render(lang = 'en', open = true) {
  if (!root) {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root?.render(
      <QueryClientProvider client={client}>
        <SiteSearchDialog projectId="docs" open={open} onOpenChange={vi.fn()} lang={lang} />
      </QueryClientProvider>,
    ),
  );
}

const input = () => document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
const sentQueries = () => mocks.get.mock.calls.map(([request]) => (request as { query: { q: string } }).query.q);
const failed = () => document.querySelector('[role="alert"]') !== null;
const showsResults = () => [...document.querySelectorAll('[role="option"]')].some((item) => item.textContent?.includes('Setup guide'));

/** Sets the field's value the way the browser does on input, then fires `input`. */
const setField = (value: string, inputType: string) =>
  act(async () => {
    const field = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
  });

/** An edit as the browser makes it: the new value, the caret after the edit (in
 *  UTF-16 units), then `input`. */
const editField = (value: string, caret: number, inputType: string) =>
  act(async () => {
    const field = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field?.setSelectionRange(caret, caret);
    field?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, isComposing: inputType === 'insertCompositionText' }));
  });

const compose = (type: 'compositionstart' | 'compositionend', data = '') =>
  act(async () => {
    input()?.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
  });

const caret = () => [input()?.selectionStart, input()?.selectionEnd];
const limitHint = () => document.getElementById(input()?.getAttribute('aria-describedby') ?? '');

/** Types `text` one code point at a time at the end of the field. */
const typeText = async (text: string) => {
  for (const codePoint of text) await setField(`${input()?.value ?? ''}${codePoint}`, 'insertText');
};

/** Waits for the search to settle, then checks that every request stayed within
 *  the API's limit and the dialog shows results, not its error state. */
const expectSearchWithinLimit = async () => {
  await until(() => showsResults() || failed());
  expect(failed(), 'the dialog shows its error state').toBe(false);
  expect(showsResults()).toBe(true);
  expect(mocks.get).toHaveBeenCalled();
  for (const q of sentQueries()) {
    expect(codePoints(q)).toBeLessThanOrEqual(200);
    expect(hasLoneSurrogate(q)).toBe(false);
    expect(searchQuery.safeParse({ q }).success).toBe(true);
  }
};

describe('reader search query length', () => {
  it('rejects overflow in beforeinput, preserving the field and its selection', async () => {
    await render();
    const full = 'a'.repeat(200);
    await setField(full, 'insertText');
    input()?.setSelectionRange(50, 50);
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'b' });
    await act(async () => input()?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input()?.value).toBe(full);
    expect(caret()).toEqual([50, 50]);
    expect(limitHint()?.textContent).toContain('200');
  });

  it('fits a cancelable edit before insertion and preserves its selected suffix', async () => {
    await render();
    await setField('a'.repeat(200), 'insertText');
    input()?.setSelectionRange(50, 60);
    vi.mocked(document.execCommand).mockImplementation((_command, _showUi, text) => {
      expect(caret()).toEqual([50, 60]);
      input()?.setRangeText(text ?? '', 50, 60, 'end');
      return true;
    });
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: `👩🏽‍💻${'b'.repeat(20)}` });
    await act(async () => input()?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input()?.value).toBe(`${'a'.repeat(50)}👩🏽‍💻${'b'.repeat(6)}${'a'.repeat(140)}`);
    expect(caret()).toEqual([63, 63]);
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, `👩🏽‍💻${'b'.repeat(6)}`);
    await expectSearchWithinLimit();
  });

  it('collapses an identical selection replacement after the retained text', async () => {
    await render();
    await setField('a'.repeat(200), 'insertText');
    input()?.setSelectionRange(50, 60);
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'a'.repeat(20) });
    await act(async () => input()?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input()?.value).toBe('a'.repeat(200));
    expect(caret()).toEqual([60, 60]);
  });

  it('inserts retained text even when the final caret moves before a newly formed flag', async () => {
    await render();
    const prefix = 'a'.repeat(198);
    await setField(`${prefix}x🇸`, 'insertText');
    input()?.setSelectionRange(198, 199);
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '🇺بَ' });
    await act(async () => input()?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input()?.value).toBe(`${prefix}🇺🇸`);
    expect(caret()).toEqual([198, 198]);
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '🇺');
    expect(limitHint()?.textContent).toContain('200');
  });

  it.each(['absent', 'false', 'throw'])('rejects overflow without changing text or selection when native insertion is %s', async (mode) => {
    await render();
    const previous = 'a'.repeat(200);
    await setField(previous, 'insertText');
    input()?.setSelectionRange(50, 60, 'backward');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value:
        mode === 'absent'
          ? undefined
          : vi.fn(() => {
              if (mode === 'throw') throw new DOMException('Native insertion is unsupported');
              return false;
            }),
    });
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'b'.repeat(30) });
    await act(async () => input()?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input()?.value).toBe(previous);
    expect(caret()).toEqual([50, 60]);
    expect(input()?.selectionDirection).toBe('backward');
    expect(limitHint()?.textContent).toContain('200');
    await expectSearchWithinLimit();
  });

  it('leaves active Latin composition beforeinput alone even when it overflows', async () => {
    await render();
    await setField('a'.repeat(200), 'insertText');
    await compose('compositionstart');
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'e' });
    await act(async () => input()?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(limitHint()).toBeNull();
  });

  it('clears a stale limit announcement on close and reopen', async () => {
    await render();
    await setField('x'.repeat(201), 'insertFromPaste');
    expect(limitHint()?.textContent).toContain('200');
    await render('en', false);
    await render();
    expect(limitHint()).toBeNull();
    expect(input()?.value).toBe('x'.repeat(200));
  });

  it.each([
    ['en', 'Search is limited to 200 characters.'],
    ['ar', 'الحد الأقصى للبحث هو 200 حرفًا.'],
  ])('shows and politely announces a cut in %s, without repeating held keystrokes', async (lang, message) => {
    await render(lang);
    await setField('a'.repeat(200), 'insertText');
    expect(limitHint()).toBeNull();
    await editField(`${'a'.repeat(200)}b`, 201, 'insertText');
    const hint = limitHint();
    expect(hint?.textContent).toBe(message);
    expect(hint?.getAttribute('aria-live')).toBe('polite');
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.className).not.toContain('sr-only');
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    if (hint) observer.observe(hint, { subtree: true, childList: true, characterData: true });
    await typeText('bbbb');
    observer.disconnect();
    expect(mutations).toHaveLength(0);
    await setField('short', 'deleteContentBackward');
    expect(limitHint()).toBeNull();
    expect(hint?.textContent).not.toBe(message);
    await setField('z'.repeat(201), 'insertFromPaste');
    expect(limitHint()?.textContent).toBe(message);
  });

  it.each(['👩🏽‍💻', 'بَ', '🇸🇦'])('keeps whole graphemes through paste and the real transport: %s', async (cluster) => {
    await render();
    await setField(`${'x'.repeat(199)}${cluster}extra`, 'insertFromPaste');
    expect(input()?.value).toBe('x'.repeat(199));
    expect(limitHint()?.textContent).toContain('200');
    await expectSearchWithinLimit();
    expect(sentQueries().at(-1)).toBe('x'.repeat(199));
  });

  it('caps a pre-filled field on input without keeping part of a huge grapheme', async () => {
    await render();
    await setField(`ب${'َ'.repeat(200)}`, 'insertReplacementText');
    expect(input()?.value).toBe('');
    expect(limitHint()?.textContent).toContain('200');
    expect(sentQueries()).toEqual([]);
  });

  it('stops typing at 200 characters and never sends a longer query', async () => {
    await render();
    await setField('x'.repeat(198), 'insertText');
    await typeText('abcdef');
    await expectSearchWithinLimit();
    expect(sentQueries().at(-1)).toBe(`${'x'.repeat(198)}ab`);
    expect(input()?.value).toBe(`${'x'.repeat(198)}ab`);
  });

  it.each([
    ['English', 'en', 'x'],
    ['Arabic', 'ar', ARABIC],
    ['emoji', 'en', EMOJI],
  ])('cuts a pasted 250-character %s query to 200 and shows its results, not an error', async (_name, lang, unit) => {
    await render(lang);
    await setField(unit.repeat(250), 'insertFromPaste');
    await expectSearchWithinLimit();
    expect(sentQueries().at(-1)).toBe(unit.repeat(200));
    expect(input()?.value).toBe(unit.repeat(200));
  });

  it('never splits an emoji at the limit', async () => {
    await render();
    // 199 letters then emoji: the 200th code point is an emoji, the 201st is cut whole.
    await setField(`${'x'.repeat(199)}${EMOJI}${EMOJI}`, 'insertFromPaste');
    await expectSearchWithinLimit();
    expect(input()?.value).toBe(`${'x'.repeat(199)}${EMOJI}`);
  });

  it('cuts text typed or pasted before the dialog loaded to 200 characters', async () => {
    beginSearchKeystrokes();
    const held = document.activeElement as HTMLInputElement;
    held.value = `${ARABIC.repeat(199)}${EMOJI.repeat(51)}`;
    await render('ar');
    await expectSearchWithinLimit();
    // The old UTF-16 cut (300 units) also left half an emoji at the end.
    expect(input()?.value).toBe(`${ARABIC.repeat(199)}${EMOJI}`);
    expect(limitHint()?.textContent).toContain('200');
  });

  it('cuts held keystrokes before a ZWJ grapheme and announces the cut', async () => {
    beginSearchKeystrokes();
    const held = document.activeElement as HTMLInputElement;
    held.value = `${'x'.repeat(199)}👨‍👩‍👧‍👦`;
    await render();
    expect(input()?.value).toBe('x'.repeat(199));
    expect(limitHint()?.textContent).toContain('200');
    await expectSearchWithinLimit();
  });

  it('keeps a recent search longer than the limit from reaching the API whole', async () => {
    // Stored by an older reader, or edited by hand.
    const stored = JSON.stringify([`${'y'.repeat(199)}👩🏽‍💻`]);
    window.localStorage.setItem('nibleaf:site-search:recent:docs', stored);
    await render();
    const recent = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes('yyyy'));
    expect(recent).toBeDefined();
    await act(async () => recent?.click());
    await expectSearchWithinLimit();
    expect(input()?.value).toBe('y'.repeat(199));
    expect(limitHint()?.textContent).toContain('200');
    expect(window.localStorage.getItem('nibleaf:site-search:recent:docs')).toBe(stored);
  });

  describe('editing inside a full field (#851)', () => {
    const full = `${'a'.repeat(199)}z`;

    it.each(['input-first', 'compositionend-first'])(
      'does not request an empty transport prefix during an oversized first grapheme in %s order',
      async (order) => {
        await render('ar');
        const raw = `ب${'َ'.repeat(200)}`;
        await compose('compositionstart');
        await editField(raw, raw.length, 'insertCompositionText');
        await settle();
        expect(input()?.value).toBe(raw);
        expect(limitHint()).toBeNull();
        expect(sentQueries()).toEqual([]);
        expect(failed()).toBe(false);
        if (order === 'input-first') await editField(raw, raw.length, 'insertText');
        await compose('compositionend', raw);
        if (order === 'compositionend-first') await editField(raw, raw.length, 'insertText');
        await settle();
        expect(input()?.value).toBe('');
        expect(caret()).toEqual([0, 0]);
        expect(limitHint()?.textContent).toContain('200');
        expect(sentQueries()).toEqual([]);
        expect(failed()).toBe(false);
      },
    );

    it.each(['input-first', 'compositionend-first'])('reconciles Latin composition in %s order without cutting while active', async (order) => {
      await render();
      const prefix = 'a'.repeat(198);
      await setField(prefix, 'insertText');
      await compose('compositionstart');
      const composed = `${prefix}e\u0301xy`;
      await editField(composed, composed.length, 'insertCompositionText');
      expect(input()?.value).toBe(composed);
      expect(limitHint()).toBeNull();
      if (order === 'input-first') await editField(composed, composed.length, 'insertText');
      expect(input()?.value).toBe(composed);
      await compose('compositionend', 'e\u0301xy');
      if (order === 'compositionend-first') await editField(composed, composed.length, 'insertText');
      expect(input()?.value).toBe(`${prefix}e\u0301`);
      expect(caret()).toEqual([200, 200]);
      expect(limitHint()?.textContent).toContain('200');
      await expectSearchWithinLimit();
      expect(sentQueries().at(-1)).toBe(`${prefix}e\u0301`);
    });

    it('accepts an under-limit compositionend value before its final input event', async () => {
      await render();
      await setField('a'.repeat(198), 'insertText');
      await compose('compositionstart');
      await editField(`${'a'.repeat(198)}e`, 199, 'insertCompositionText');
      const committed = `${'a'.repeat(198)}é`;
      await act(async () => {
        const field = input();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, committed);
        field?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'é' }));
      });
      await until(() => sentQueries().at(-1) === committed);
      expect(input()?.value).toBe(committed);
      expect(sentQueries().at(-1)).toBe(committed);
      await editField(committed, 199, 'insertText');
      expect(input()?.value).toBe(committed);
      expect(limitHint()).toBeNull();
      await expectSearchWithinLimit();
    });

    it('drops a character typed mid-string at the limit and keeps the caret where it was typed', async () => {
      await render();
      await setField(full, 'insertText');
      // The caret is at the start; typing `b` makes 201 characters.
      await editField(`b${full}`, 1, 'insertText');
      expect(input()?.value).toBe(full);
      expect(caret()).toEqual([0, 0]);
      // Typing on, mid-string, still lands where the caret is.
      await editField(`${full.slice(0, 50)}c${full.slice(50)}`, 51, 'insertText');
      expect(input()?.value).toBe(full);
      expect(caret()).toEqual([50, 50]);
      await expectSearchWithinLimit();
    });

    it('keeps the part of a mid-string paste that fits, with the caret after it', async () => {
      await render();
      const before = `${'a'.repeat(100)}${'z'.repeat(95)}`; // 195 characters, caret after the a's
      await setField(before, 'insertText');
      await editField(`${'a'.repeat(100)}${'b'.repeat(20)}${'z'.repeat(95)}`, 120, 'insertFromPaste');
      expect(input()?.value).toBe(`${'a'.repeat(100)}${'b'.repeat(5)}${'z'.repeat(95)}`);
      expect(caret()).toEqual([105, 105]);
      await expectSearchWithinLimit();
    });

    it('keeps whole emoji of a mid-string paste and never puts the caret inside one', async () => {
      await render();
      const before = `${'a'.repeat(100)}${'z'.repeat(95)}`;
      await setField(before, 'insertText');
      await editField(`${'a'.repeat(100)}${EMOJI.repeat(20)}${'z'.repeat(95)}`, 140, 'insertFromPaste');
      expect(input()?.value).toBe(`${'a'.repeat(100)}${EMOJI.repeat(5)}${'z'.repeat(95)}`);
      expect(caret()).toEqual([110, 110]); // 5 emoji are 10 UTF-16 units
      await expectSearchWithinLimit();
    });

    it('leaves an IME composition uncut and applies the limit when it ends', async () => {
      await render();
      await setField('a'.repeat(199), 'insertText');
      await compose('compositionstart');
      await editField(`${'a'.repeat(199)}にほ`, 201, 'insertCompositionText');
      await editField(`${'a'.repeat(199)}日本語`, 202, 'insertCompositionText');
      // Mid-composition the field keeps what the IME shows.
      expect(input()?.value).toBe(`${'a'.repeat(199)}日本語`);
      await compose('compositionend', '日本語');
      expect(input()?.value).toBe(`${'a'.repeat(199)}日`);
      expect(caret()).toEqual([200, 200]);
      // The transport cut what went out while the composition ran.
      await expectSearchWithinLimit();
    });

    it('changes nothing under the limit: the raw value, as on main', async () => {
      await render();
      await setField('a'.repeat(198), 'insertText');
      await editField(`b${'a'.repeat(198)}`, 1, 'insertText');
      expect(input()?.value).toBe(`b${'a'.repeat(198)}`);
      expect(caret()).toEqual([1, 1]);
    });
  });
});
