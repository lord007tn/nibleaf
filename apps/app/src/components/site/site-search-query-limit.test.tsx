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
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  cancelSearchKeystrokes();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const until = async (ready: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !ready(); attempt += 1) await settle();
};

async function render(lang = 'en') {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <QueryClientProvider client={client}>
        <SiteSearchDialog projectId="docs" open onOpenChange={vi.fn()} lang={lang} />
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
  });

  it('keeps a recent search longer than the limit from reaching the API whole', async () => {
    // Stored by an older reader, or edited by hand.
    window.localStorage.setItem('nibleaf:site-search:recent:docs', JSON.stringify(['y'.repeat(260)]));
    await render();
    const recent = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes('yyyy'));
    expect(recent).toBeDefined();
    await act(async () => recent?.click());
    await expectSearchWithinLimit();
    expect(input()?.value).toBe('y'.repeat(200));
  });
});
