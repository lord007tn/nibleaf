// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  navigate: vi.fn(),
  askAi: vi.fn(),
  refetch: vi.fn(),
  debounced: undefined as string | undefined,
  realLabels: false,
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: mocks.navigate }) }));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: mocks.search }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [mocks.debounced ?? value] }));
vi.mock('@nibleaf/i18n/site', async (importOriginal) => {
  const { siteT } = await importOriginal<typeof import('@nibleaf/i18n/site')>();
  return { siteT: (language?: string) => (mocks.realLabels ? siteT(language) : (key: string) => key) };
});
vi.mock('@nibleaf/i18n/site-search', async (importOriginal) => {
  const { siteSearchT } = await importOriginal<typeof import('@nibleaf/i18n/site-search')>();
  return { siteSearchT: (language?: string) => (mocks.realLabels ? siteSearchT(language) : (key: string) => key) };
});

import { SearchShell, SiteSearch } from './site-search';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];
const hit = {
  id: 'setup',
  path: 'setup',
  title: 'Setup guide',
  description: 'Get going',
  snippet: 'Configure the project.',
  language: 'en',
  icon: null,
};
const sectionHit = {
  ...hit,
  id: 'billing',
  path: 'billing',
  title: 'Billing',
  section: { id: 'refunds', title: 'Refunds' },
  snippet: 'We refund it.',
};
const suggestions = [
  { title: 'Getting started', path: 'getting-started', icon: 'rocket' },
  { title: 'Installation', path: 'installation' },
];

// Load the lazy dialog chunk up front: a cold import under a busy runner can
// outlast `vi.dynamicImportSettled()` and leave the dialog unrendered.
beforeAll(async () => {
  await import('./site-search-dialog');
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
  mocks.debounced = undefined;
  mocks.realLabels = false;
  mocks.search.mockReturnValue({ data: [], isFetching: false, error: null, refetch: mocks.refetch });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(overrides: Partial<Parameters<typeof SiteSearch>[0]> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const props = { projectId: 'docs', open: true, onOpenChange: vi.fn(), onAskAi: mocks.askAi, lang: 'en', ...overrides };
  const rerender = (next: Partial<Parameters<typeof SiteSearch>[0]> = {}) => act(async () => root.render(<SiteSearch {...props} {...next} />));
  await rerender();
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return { props, rerender };
}

const input = () => document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const option = (text: string) => options().find((item) => item.textContent?.includes(text));
const status = () => document.querySelector('[role="status"][aria-live="polite"]')?.textContent;

const typeQuery = (value: string) =>
  act(async () => {
    const field = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field?.dispatchEvent(new Event('input', { bubbles: true }));
  });

const press = (key: string) =>
  act(async () => {
    input()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

const select = async (text: string) => {
  const item = option(text);
  if (!item) throw new Error(`Missing option ${text}`);
  await act(async () => item.click());
  await act(async () => {
    await vi.dynamicImportSettled();
  });
};

describe('published reader search', () => {
  it('opens with the shortcut before loading the dialog and hands a question to the assistant', async () => {
    const { props, rerender } = await render({ open: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
    await rerender({ open: true });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await typeQuery('How do I start?');
    await select('searchAskAiAbout');
    expect(mocks.askAi).toHaveBeenCalledExactlyOnceWith('How do I start?');
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('never opens while the reader types with AltGr (Ctrl+Alt on Windows) in a field', async () => {
    const { props } = await render({ open: false });
    const field = document.createElement('input');
    document.body.append(field);
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ĸ', code: 'KeyK', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    field.remove();
  });

  it.each([
    ['en', 'Search documentation', 'Results'],
    ['ar', 'البحث في الوثائق', 'النتائج'],
    ['ar-SA', 'البحث في الوثائق', 'النتائج'],
  ])('names the combobox and controlled result list in %s, independently of a custom placeholder', async (lang, label, results) => {
    mocks.realLabels = true;
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render({ lang, placeholder: 'Custom site prompt', onAskAi: undefined });
    const field = document.querySelector<HTMLInputElement>('[role="combobox"]');
    const list = document.querySelector('[role="listbox"]');
    expect(document.getElementById(field?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(label);
    expect(field?.placeholder).toBe('Custom site prompt');
    expect(list?.getAttribute('aria-label')).toBe(results);
    expect(field?.getAttribute('aria-controls')).toBe(list?.id);
    await typeQuery('setup');
    expect(list?.querySelector('[role="option"]')?.textContent).toContain('Setup guide');
    // Every language is searched; the reader's own is preferred in the ranking.
    expect(mocks.search).toHaveBeenLastCalledWith('docs', expect.any(String), expect.objectContaining({ prefer: lang }));
    expect(mocks.search.mock.lastCall?.[2]).not.toHaveProperty('language');
  });

  it('closes with a keyboard Esc hint or a plain Cancel action instead of an icon-only X', async () => {
    mocks.realLabels = true;
    const { props } = await render();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    const escapeHint = buttons.find((button) => button.textContent?.includes('Esc'));
    const cancel = buttons.find((button) => button.textContent === 'Cancel');
    // The visible "Esc" stays part of the accessible name (WCAG 2.5.3).
    expect(escapeHint?.getAttribute('aria-label')).toBe('Close search (Esc)');
    expect(escapeHint?.getAttribute('aria-keyshortcuts')).toBe('Escape');
    expect(cancel).toBeDefined();
    // No icon-only X button.
    expect(document.querySelector('[role="dialog"] button svg.lucide-x')).toBeNull();
    await act(async () => cancel?.click());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    await act(async () => escapeHint?.click());
    expect(props.onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('announces a failed search, offers a retry, and hides cached results', async () => {
    const { rerender } = await render();
    await typeQuery('setup');
    expect(document.body.textContent).toContain('searchNoResultsFor');
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: new Error('Network unavailable'), refetch: mocks.refetch });
    await rerender();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('searchFailed');
    // Messages and their buttons sit beside the listbox, which may only hold options.
    expect(alert?.closest('[role="listbox"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Setup guide');
    await act(async () => alert?.querySelector('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input());
    // A query that never loaded goes back to pending on retry: result skeletons.
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null, refetch: mocks.refetch });
    await rerender();
    expect(document.querySelector('[data-search-skeleton]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the error in place with a working Retry when a refresh of loaded results fails', async () => {
    const { rerender } = await render();
    await typeQuery('setup');
    // The query has results from before, so a failed refresh keeps its error while it retries.
    mocks.search.mockReturnValue({ data: [hit], isFetching: true, error: new Error('Network unavailable'), refetch: mocks.refetch });
    await rerender();
    const retry = document.querySelector('[role="alert"] button');
    expect(retry?.getAttribute('aria-busy')).toBe('true');
    expect(retry?.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('[data-search-skeleton]')).toBeNull();
    expect(document.body.textContent).not.toContain('Setup guide');
  });

  it('keeps the last results dimmed and inert while the next query loads, and drops them when the input is cleared', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render();
    await typeQuery('setup');
    expect(document.body.textContent).toContain('Setup guide');
    expect(status()).toBe('searchResultCount');
    const results = () => document.querySelector('[aria-busy]');
    expect(results()?.getAttribute('aria-busy')).toBe('false');
    // Waiting for the debounce: the old results stay, but can't be opened.
    mocks.debounced = 'setup';
    await typeQuery('billing');
    expect(status()).toBe('searching');
    expect(results()?.getAttribute('aria-busy')).toBe('true');
    expect(option('Setup guide')?.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('[data-search-skeleton]')).toBeNull();
    // For a keyword nothing is selected, Ask AI included: Enter waits for the new results.
    expect(option('searchAskAiAbout')?.getAttribute('aria-disabled')).toBe('true');
    expect(options().some((item) => item.getAttribute('aria-selected') === 'true')).toBe(false);
    await press('Enter');
    expect(mocks.askAi).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('searchBackToResults');
    // A question still starts on "Ask AI".
    await typeQuery('How do I bill?');
    expect(option('searchAskAiAbout')?.getAttribute('aria-selected')).toBe('true');
    // Then the query's placeholder data (the previous results) while it fetches.
    mocks.debounced = undefined;
    mocks.search.mockReturnValue({ data: [hit], isPlaceholderData: true, isFetching: true, error: null });
    await typeQuery('billing!');
    expect(status()).toBe('searching');
    expect(option('Setup guide')?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => option('Setup guide')?.click());
    expect(mocks.navigate).not.toHaveBeenCalled();
    await typeQuery('');
    expect(document.body.textContent).toContain('searchPrompt');
    expect(document.body.textContent).not.toContain('Setup guide');
  });

  it('keeps the version filter a full-size touch target', async () => {
    await render({
      versions: [
        { id: 'v1', name: 'v1', slug: 'v1', isDefault: true },
        { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
      ],
    });
    // 44px on coarse pointers (phones and touch tablets), compact with a mouse.
    expect(document.querySelector('[aria-label="searchFilterVersion"]')?.className).toContain('pointer-coarse:h-11');
  });

  it('does not bring back results from before the field was cleared', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render();
    await typeQuery('setup');
    expect(document.body.textContent).toContain('Setup guide');
    mocks.debounced = 'setup';
    await typeQuery('');
    expect(document.body.textContent).toContain('searchPrompt');
    // Typing again before the debounce catches up, then while the new query loads.
    await typeQuery('billing');
    expect(document.body.textContent).not.toContain('Setup guide');
    expect(document.querySelector('[data-search-skeleton]')).not.toBeNull();
    mocks.debounced = undefined;
    mocks.search.mockReturnValue({ data: [hit], isPlaceholderData: true, isFetching: true, error: null });
    await typeQuery('billing ');
    expect(document.body.textContent).not.toContain('Setup guide');
    // Fresh results show, and may stand in for the next search again.
    mocks.search.mockReturnValue({ data: [{ ...hit, id: 'billing', title: 'Billing guide' }], isFetching: false, error: null });
    await typeQuery('billing');
    expect(document.body.textContent).toContain('Billing guide');
    mocks.search.mockReturnValue({
      data: [{ ...hit, id: 'billing', title: 'Billing guide' }],
      isPlaceholderData: true,
      isFetching: true,
      error: null,
    });
    await typeQuery('billing plans');
    expect(option('Billing guide')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows result-shaped skeleton rows only while a first search loads', async () => {
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null });
    await render();
    await typeQuery('setup');
    expect(status()).toBe('searching');
    expect(document.querySelectorAll('[data-search-skeleton] [data-slot="skeleton-list-row"]')).toHaveLength(3);
    expect(document.querySelector('[data-search-skeleton]')?.closest('[aria-busy="true"]')).not.toBeNull();
    // A background refresh of results already on screen shows no skeleton.
    mocks.search.mockReturnValue({ data: [hit], isFetching: true, error: null });
    await typeQuery('setup ');
    expect(document.querySelector('[data-search-skeleton]')).toBeNull();
    expect(option('Setup guide')?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('highlights the best page first and keeps "Ask AI" one step above it', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render();
    await typeQuery('setup');
    expect(options().map((item) => item.textContent?.includes('searchAskAiAbout'))).toEqual([true, false]);
    expect(option('Setup guide')?.getAttribute('aria-selected')).toBe('true');
    expect(input()?.getAttribute('aria-activedescendant')).toBe(option('Setup guide')?.id);
    await press('ArrowUp');
    expect(option('searchAskAiAbout')?.getAttribute('aria-selected')).toBe('true');
  });

  it('starts on "Ask AI" when the reader types a question', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render();
    await typeQuery('How do I set up billing?');
    expect(option('searchAskAiAbout')?.getAttribute('aria-selected')).toBe('true');
    await typeQuery('كيف أبدأ');
    expect(option('searchAskAiAbout')?.getAttribute('aria-selected')).toBe('true');
    // Arabic openers with a و/ف prefix, and ما before a longer phrase, are questions too.
    for (const question of ['وكيف أغير الخطة', 'فهل يمكنني الإلغاء', 'ما الفرق بين الإصدارين']) {
      await typeQuery(question);
      expect(option('searchAskAiAbout')?.getAttribute('aria-selected')).toBe('true');
    }
    // A short title such as "ما الجديد" (What's new), or a noun phrase such as
    // "ما بعد البيع" (after-sales), stays a keyword.
    for (const keyword of ['ما الجديد', 'ما بعد البيع']) {
      await typeQuery(keyword);
      expect(option('Setup guide')?.getAttribute('aria-selected')).toBe('true');
    }
  });

  it('announces the best match when results arrive after the keystroke, and ↓ moves on from it', async () => {
    const first = { ...hit, id: 'first', path: 'first', title: 'First guide' };
    const second = { ...hit, id: 'second', path: 'second', title: 'Second guide' };
    const { rerender } = await render();
    // The keystroke renders while the debounced search still runs.
    mocks.debounced = 'gui';
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null });
    await typeQuery('guide');
    // Results arrive in a later render, as they always do in a browser.
    mocks.debounced = undefined;
    mocks.search.mockReturnValue({ data: [first, second], isFetching: false, error: null });
    await rerender();
    expect(option('First guide')?.getAttribute('aria-selected')).toBe('true');
    expect(input()?.getAttribute('aria-activedescendant')).toBe(option('First guide')?.id);
    await press('ArrowDown');
    expect(option('Second guide')?.getAttribute('aria-selected')).toBe('true');
    expect(input()?.getAttribute('aria-activedescendant')).toBe(option('Second guide')?.id);
  });

  it('opens the best match for an Enter pressed while a keyword search loads, unless the reader types on', async () => {
    const { rerender } = await render();
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null });
    await typeQuery('setup');
    await press('Enter');
    expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await rerender();
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.navigate.mock.calls[0]?.[0]?.href).toContain('setup');
    // Typing after Enter cancels the held press.
    mocks.navigate.mockClear();
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null });
    await typeQuery('billing');
    await press('Enter');
    await typeQuery('billing plans');
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await rerender();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('drops an Enter held while loading when the reader closes search', async () => {
    const { rerender } = await render();
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null });
    await typeQuery('setup');
    await press('Enter');
    await rerender({ open: false });
    // The search finishes after the reader left; nothing may open.
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await rerender({ open: false });
    await rerender({ open: true });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('drops an Enter held while loading when the reader picks another version', async () => {
    const { rerender } = await render({
      versions: [
        { id: 'v1', name: 'v1', slug: 'v1', isDefault: true },
        { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
      ],
    });
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null });
    await typeQuery('setup');
    await press('Enter');
    const trigger = document.querySelector<HTMLElement>('[aria-label="searchFilterVersion"]');
    await act(async () => trigger?.click());
    const v2 = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === 'v2');
    expect(v2).toBeDefined();
    await act(async () => v2?.click());
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await rerender();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('announces the highlighted row again after reopening search', async () => {
    const first = { ...hit, id: 'first', path: 'first', title: 'First guide' };
    const second = { ...hit, id: 'second', path: 'second', title: 'Second guide' };
    mocks.search.mockReturnValue({ data: [first, second], isFetching: false, error: null });
    const { rerender } = await render();
    const announced = () => input()?.getAttribute('aria-activedescendant');
    const selected = () => options().find((item) => item.getAttribute('aria-selected') === 'true');
    await typeQuery('guide');
    await press('ArrowDown');
    expect(selected()?.textContent).toContain('Second guide');
    await rerender({ open: false });
    await rerender({ open: true });
    // Reopening starts again on the best match, and that is what is announced.
    expect(selected()?.textContent).toContain('First guide');
    expect(announced()).toBe(selected()?.id);
  });

  it('offers "Ask AI" above the loading rows while a question\'s first results load', async () => {
    mocks.search.mockReturnValue({ data: undefined, isFetching: true, error: null });
    await render();
    await typeQuery('How do I start?');
    const ask = option('searchAskAiAbout');
    expect(ask?.getAttribute('aria-selected')).toBe('true');
    const skeleton = document.querySelector('[data-search-skeleton]');
    expect(skeleton).not.toBeNull();
    expect(ask && skeleton ? ask.compareDocumentPosition(skeleton) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy();
    await press('Enter');
    expect(mocks.askAi).toHaveBeenCalledExactlyOnceWith('How do I start?');
  });

  it('hands the question to an external assistant from results and from an empty result', async () => {
    const onAskAi = vi.fn();
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    const { props, rerender } = await render({ onAskAi });
    await typeQuery('  How do I start?  ');
    await select('searchAskAiAbout');
    expect(onAskAi).toHaveBeenCalledExactlyOnceWith('How do I start?');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    mocks.search.mockReturnValue({ data: [], isFetching: false, error: null });
    await rerender();
    expect(document.body.textContent).toContain('searchNoResultsFor');
    await select('searchAskAiAbout');
    expect(onAskAi).toHaveBeenCalledTimes(2);
  });

  it('offers no AI row without an assistant', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render({ onAskAi: undefined });
    await typeQuery('setup');
    expect(option('searchAskAiAbout')).toBeUndefined();
  });

  it.each(['en', 'ar', 'he', 'fa', 'ur', 'ar-SA', 'he-IL', 'fa-IR', 'ur-PK'])('lays out the dialog in the direction of %s', async (lang) => {
    await render({ lang });
    const expected = lang === 'en' ? 'ltr' : 'rtl';
    expect(document.querySelector('[role="dialog"]')?.getAttribute('dir')).toBe(expected);
  });

  it('shows the matching section under its page and links straight to the heading', async () => {
    window.history.replaceState(null, '', '/sites/docs/start');
    mocks.search.mockReturnValue({ data: [sectionHit], isFetching: false, error: null });
    await render({ onAskAi: undefined, defaultLanguage: 'en' });
    await typeQuery('refund');
    expect(options().map((item) => item.textContent)).toEqual([expect.stringContaining('Billing'), expect.stringContaining('Refunds')]);
    expect(option('Refunds')?.textContent).toContain('We refund it.');
    await select('Refunds');
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/billing#refunds' });
    window.history.replaceState(null, '', '/');
  });

  it.each([
    ['الإعدادات', 'إعداد الحساب', 'إعداد'],
    ['المستخدمين', 'مُستخدِم جديد', 'مُستخدِم'],
    ['API الإعدادات إعداد', 'API إِعداد الحساب', 'إِعداد'],
  ])('highlights stemmed Arabic matches for %s while preserving original text', async (query, title, marked) => {
    mocks.search.mockReturnValue({ data: [{ ...hit, title, snippet: title, language: 'ar' }], isFetching: false });
    await render({ lang: 'ar' });
    await typeQuery(query);
    expect([...document.querySelectorAll('mark')].map((node) => node.textContent)).toContain(marked);
    expect(option(title)?.textContent).toContain(title);
  });

  it.each([
    ['الرياض', 'رياض'],
    ['عمان', 'عام'],
    ['المستخدمين', 'API_مستخدم'],
  ])('does not invent morphological matches for %s in %s', async (query, title) => {
    mocks.search.mockReturnValue({ data: [{ ...hit, title, snippet: '', language: 'ar' }], isFetching: false });
    await render({ lang: 'ar' });
    await typeQuery(query);
    expect(document.querySelectorAll('mark')).toHaveLength(0);
    expect(option(title)?.textContent).toContain(title);
  });

  it('highlights Arabic matches the way search folds them (alef forms, diacritics)', async () => {
    mocks.search.mockReturnValue({
      data: [{ ...hit, title: 'إِلْغَاء الاشتراك', language: 'ar' }],
      isFetching: false,
      error: null,
    });
    await render({ onAskAi: undefined, lang: 'ar' });
    await typeQuery('الغاء');
    expect(document.querySelector('[role="option"] mark')?.textContent).toBe('إِلْغَاء');
  });

  it('keeps text typed before the dialog loaded, with the caret at the end', async () => {
    const { default: SiteSearchDialog } = await import('./site-search-dialog');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<SiteSearchDialog projectId="docs" open onOpenChange={vi.fn()} lang="en" initialQuery="sea" />));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(input()?.value).toBe('sea');
    expect(input()?.selectionStart).toBe(3);
  });

  it('shows a working input at once while the dialog code is still loading', async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <SearchShell
          value=""
          onChange={onChange}
          onClose={onClose}
          placeholder="Search documentation…"
          label="Search documentation"
          cancelLabel="Cancel"
          rtl
        />,
      ),
    );
    const field = container.querySelector('input');
    expect(document.activeElement).toBe(field);
    // It is a named modal of its own while the dialog code loads.
    const shellDialog = container.querySelector('[role="dialog"]');
    expect(shellDialog?.getAttribute('aria-modal')).toBe('true');
    expect(shellDialog?.getAttribute('aria-label')).toBe('Search documentation');
    expect(shellDialog?.getAttribute('dir')).toBe('rtl');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'r');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('r');
    await act(async () => field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    const cancel = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cancel');
    await act(async () => cancel?.click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('labels a result from another published language', async () => {
    mocks.search.mockReturnValue({ data: [{ ...hit, language: 'ar', title: 'دليل الإعداد' }], isFetching: false, error: null });
    await render({ onAskAi: undefined });
    await typeQuery('setup');
    expect(option('دليل الإعداد')?.textContent).toContain('العربية');
  });

  it('remembers searches that led somewhere and lets the reader reuse or clear them', async () => {
    window.history.replaceState(null, '', '/sites/docs/start');
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    const { rerender } = await render({ onAskAi: undefined, suggestions });
    await typeQuery('setup');
    await select('Setup guide');
    await typeQuery('');
    await rerender({ open: false });
    await rerender({ open: true });
    expect(document.body.textContent).toContain('searchRecent');
    await select('setup');
    expect(input()?.value).toBe('setup');
    await typeQuery('');
    await select('searchClearRecent');
    expect(document.body.textContent).not.toContain('searchRecent');
    expect(window.localStorage.getItem('nibleaf:site-search:recent:docs')).toBe('[]');
    window.history.replaceState(null, '', '/');
  });

  it('keeps current results through a background refetch of the same query', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    const { rerender } = await render({ onAskAi: undefined });
    await typeQuery('setup');
    mocks.search.mockReturnValue({ data: [hit], isFetching: true, error: null });
    await rerender();
    expect(option('Setup guide')?.getAttribute('aria-selected')).toBe('true');
    expect(status()).toBe('searchResultCount');
  });

  it('links version-independent suggestions without a version prefix', async () => {
    window.history.replaceState(null, '', '/sites/docs/start');
    const versions = [
      { id: 'main', name: 'main', slug: 'main', isDefault: true },
      { id: 'v1', name: 'v1', slug: 'v1', isDefault: false },
    ];
    await render({
      onAskAi: undefined,
      lang: 'en',
      defaultLanguage: 'en',
      version: 'v1',
      versions,
      suggestions: [
        { title: 'API', path: 'api-reference/auth', versionIndependent: true },
        { title: 'Guide', path: 'guide' },
      ],
    });
    await select('API');
    expect(mocks.navigate).toHaveBeenLastCalledWith({ href: '/sites/docs/api-reference/auth' });
    await select('Guide');
    expect(mocks.navigate).toHaveBeenLastCalledWith({ href: '/sites/docs/v1/guide' });
    window.history.replaceState(null, '', '/');
  });

  it('suggests pages before typing and when nothing matches', async () => {
    window.history.replaceState(null, '', '/sites/docs/start');
    const { rerender } = await render({ onAskAi: undefined, suggestions, defaultLanguage: 'en' });
    expect(document.body.textContent).toContain('searchSuggested');
    expect(option('Getting started')?.getAttribute('aria-selected')).toBe('true');
    await typeQuery('kubernetes');
    await rerender();
    expect(document.body.textContent).toContain('searchNoResultsHint');
    await select('Installation');
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/installation' });
    window.history.replaceState(null, '', '/');
  });
});

it('routes a selected search result with its language and selected version', async () => {
  window.history.replaceState(null, '', '/sites/docs/start');
  mocks.search.mockReturnValue({ data: [{ ...hit, language: 'ar' }], isFetching: false, error: null });
  await render({ lang: 'ar', version: 'v2', onAskAi: undefined });
  await typeQuery('Setup');
  const result = document.querySelector<HTMLElement>('[role="option"]');
  if (!result) throw new Error('Missing search result');
  await act(async () => result.click());
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/v2/setup?lang=ar' });
  window.history.replaceState(null, '', '/');
});

it('keeps default-language search navigation on the clean URL', async () => {
  window.history.replaceState(null, '', '/sites/docs/start');
  mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
  await render({ lang: 'en', defaultLanguage: 'en', onAskAi: undefined });
  await typeQuery('Setup');
  const result = document.querySelector<HTMLElement>('[role="option"]');
  if (!result) throw new Error('Missing search result');
  await act(async () => result.click());
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/setup' });
  window.history.replaceState(null, '', '/');
});
