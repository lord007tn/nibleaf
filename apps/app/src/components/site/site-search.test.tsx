// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  navigate: vi.fn(),
  answer: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
  debounced: undefined as string | undefined,
  realLabels: false,
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: mocks.navigate }) }));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: mocks.search, useAnswerSite: mocks.answer }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [mocks.debounced ?? value] }));
vi.mock('@nibleaf/i18n/site', async (importOriginal) => {
  const { siteT } = await importOriginal<typeof import('@nibleaf/i18n/site')>();
  return { siteT: (language?: string) => (mocks.realLabels ? siteT(language) : (key: string) => key) };
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

// Load the lazy dialog and answer chunks up front: a cold import under a busy
// runner can outlast `vi.dynamicImportSettled()` and leave the dialog unrendered.
beforeAll(async () => {
  await Promise.all([import('./site-search-dialog'), import('./site-search-answer')]);
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
  mocks.answer.mockReturnValue({ mutate: mocks.mutate, variables: undefined, isPending: false, data: null, error: null });
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
  const props = { projectId: 'docs', open: true, onOpenChange: vi.fn(), aiAnswers: true, lang: 'en', ...overrides };
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
  it('opens with the shortcut before loading the dialog and keeps the answer view when reopened', async () => {
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
    await rerender({ open: false });
    await rerender({ open: true });
    expect(document.body.textContent).toContain('searchBackToResults');
  });

  it.each([
    ['en', 'Search documentation', 'Results'],
    ['ar', 'البحث في الوثائق', 'النتائج'],
    ['ar-SA', 'البحث في الوثائق', 'النتائج'],
  ])('names the combobox and controlled result list in %s, independently of a custom placeholder', async (lang, label, results) => {
    mocks.realLabels = true;
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render({ lang, placeholder: 'Custom site prompt', aiAnswers: false });
    const field = document.querySelector<HTMLInputElement>('[role="combobox"]');
    const list = document.querySelector('[role="listbox"]');
    expect(document.getElementById(field?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(label);
    expect(field?.placeholder).toBe('Custom site prompt');
    expect(list?.getAttribute('aria-label')).toBe(results);
    expect(field?.getAttribute('aria-controls')).toBe(list?.id);
    await typeQuery('setup');
    expect(list?.querySelector('[role="option"]')?.textContent).toContain('Setup guide');
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
  });

  it('does not show old results while waiting for the typed query debounce or after the input is cleared', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render();
    await typeQuery('setup');
    expect(document.body.textContent).toContain('Setup guide');
    expect(status()).toBe('searchResultCount');
    mocks.debounced = 'setup';
    await typeQuery('billing');
    expect(status()).toBe('searching');
    expect(document.body.textContent).not.toContain('Setup guide');
    await typeQuery('');
    expect(document.body.textContent).toContain('searchPrompt');
    expect(document.body.textContent).not.toContain('Setup guide');
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
  });

  it('hands the question to an external assistant from results and from an empty result', async () => {
    const onAskAi = vi.fn();
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    const { props, rerender } = await render({ onAskAi });
    await typeQuery('  How do I start?  ');
    await select('searchAskAiAbout');
    expect(onAskAi).toHaveBeenCalledExactlyOnceWith('How do I start?');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
    mocks.search.mockReturnValue({ data: [], isFetching: false, error: null });
    await rerender();
    expect(document.body.textContent).toContain('searchNoResultsFor');
    await select('searchAskAiAbout');
    expect(onAskAi).toHaveBeenCalledTimes(2);
  });

  it('offers no AI row when neither built-in answers nor an assistant are available', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render({ aiAnswers: false });
    await typeQuery('setup');
    expect(option('searchAskAiAbout')).toBeUndefined();
  });

  it('asks the built-in answer view immediately and submits again with Enter', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render();
    await typeQuery('How do I start?');
    await select('searchAskAiAbout');
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ projectId: 'docs', query: 'How do I start?', language: 'en' });
    await press('Enter');
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    const back = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('searchBackToResults'));
    await act(async () => back?.click());
    expect(option('Setup guide')).toBeDefined();
  });

  it.each(['en', 'ar', 'he', 'fa', 'ur', 'ar-SA', 'he-IL', 'fa-IR', 'ur-PK'])(
    'lays out the dialog and answer view in the direction of %s',
    async (lang) => {
      await render({ lang });
      await typeQuery('How do I start?');
      await select('searchAskAiAbout');
      const expected = lang === 'en' ? 'ltr' : 'rtl';
      expect(document.querySelector('[role="dialog"]')?.getAttribute('dir')).toBe(expected);
      expect(document.querySelector('section[aria-labelledby]')?.getAttribute('dir')).toBe(expected);
    },
  );

  it('honors the published language direction without changing the requested answer language', async () => {
    await render({ lang: 'en', direction: 'rtl' });
    await typeQuery('How do I start?');
    await select('searchAskAiAbout');
    expect(document.querySelector('section[aria-labelledby]')?.getAttribute('dir')).toBe('rtl');
    expect(mocks.mutate).toHaveBeenCalledWith({ projectId: 'docs', query: 'How do I start?', language: 'en' });
  });

  it('returns to keyword search if AI answers are disabled while the answer view is open', async () => {
    const { rerender } = await render();
    await typeQuery('setup');
    await select('searchAskAiAbout');
    expect(document.body.textContent).toContain('searchBackToResults');
    await rerender({ aiAnswers: false });
    expect(document.body.textContent).not.toContain('searchBackToResults');
    expect(document.body.textContent).toContain('searchNoResultsFor');
  });

  it.each(['query', 'language', 'version'])('hides AI answers and citations when their %s scope changes', async (scope) => {
    mocks.answer.mockReturnValue({
      mutate: mocks.mutate,
      variables: { projectId: 'docs', query: 'setup', language: 'en' },
      isPending: false,
      data: {
        answer: 'The saved answer [S1].',
        citations: [{ id: 'S1', path: 'setup', title: 'Saved source', snippet: 'Evidence', direction: 'ltr' }],
      },
      error: null,
    });
    const { rerender } = await render();
    await typeQuery('setup');
    await select('searchAskAiAbout');
    expect(document.body.textContent).toContain('The saved answer');
    expect(document.body.textContent).toContain('Saved source');
    if (scope === 'query') await typeQuery('billing');
    else await rerender(scope === 'language' ? { lang: 'ar' } : { version: 'v2' });
    expect(document.body.textContent).not.toContain('The saved answer');
    expect(document.body.textContent).not.toContain('Saved source');
  });

  it('renders answer formatting and code while keeping model HTML and remote links inert', async () => {
    mocks.answer.mockReturnValue({
      mutate: mocks.mutate,
      variables: { projectId: 'docs', query: 'setup', language: 'en' },
      isPending: false,
      data: {
        answer:
          '**Configure storage** [S1]\n\n```sh\nAPI_URL=http://localhost:4311\n```\n\n[Untrusted link](https://example.invalid/collect) <img src="https://example.invalid/pixel">',
        citations: [{ id: 'S1', path: 'setup', title: 'Setup', snippet: 'Evidence', direction: 'ltr' }],
      },
      error: null,
    });
    await render();
    await typeQuery('setup');
    await select('searchAskAiAbout');
    expect(document.querySelector('strong')?.textContent).toBe('Configure storage');
    expect(document.querySelector('pre code')?.textContent).toContain('API_URL=http://localhost:4311');
    expect(document.querySelector('pre')?.getAttribute('dir')).toBe('ltr');
    expect(document.querySelector('img[src*="example.invalid"]')).toBeNull();
    expect(document.querySelector('a[href*="example.invalid"]')).toBeNull();
    expect(document.querySelector('a[href*="setup"]')).not.toBeNull();
  });

  it('shows the matching section under its page and links straight to the heading', async () => {
    window.history.replaceState(null, '', '/sites/docs/start');
    mocks.search.mockReturnValue({ data: [sectionHit], isFetching: false, error: null });
    await render({ aiAnswers: false, defaultLanguage: 'en' });
    await typeQuery('refund');
    expect(options().map((item) => item.textContent)).toEqual([expect.stringContaining('Billing'), expect.stringContaining('Refunds')]);
    expect(option('Refunds')?.textContent).toContain('We refund it.');
    await select('Refunds');
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/billing#refunds' });
    window.history.replaceState(null, '', '/');
  });

  it('highlights Arabic matches the way search folds them (alef forms, diacritics)', async () => {
    mocks.search.mockReturnValue({
      data: [{ ...hit, title: 'إِلْغَاء الاشتراك', language: 'ar' }],
      isFetching: false,
      error: null,
    });
    await render({ aiAnswers: false, lang: 'ar' });
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
    await render({ aiAnswers: false });
    await typeQuery('setup');
    expect(option('دليل الإعداد')?.textContent).toContain('العربية');
  });

  it('remembers searches that led somewhere and lets the reader reuse or clear them', async () => {
    window.history.replaceState(null, '', '/sites/docs/start');
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    const { rerender } = await render({ aiAnswers: false, suggestions });
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
    const { rerender } = await render({ aiAnswers: false });
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
      aiAnswers: false,
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
    const { rerender } = await render({ aiAnswers: false, suggestions, defaultLanguage: 'en' });
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
  await render({ lang: 'ar', version: 'v2', aiAnswers: false });
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
  await render({ lang: 'en', defaultLanguage: 'en', aiAnswers: false });
  await typeQuery('Setup');
  const result = document.querySelector<HTMLElement>('[role="option"]');
  if (!result) throw new Error('Missing search result');
  await act(async () => result.click());
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/setup' });
  window.history.replaceState(null, '', '/');
});
