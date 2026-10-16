// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  answer: vi.fn(),
  mutate: vi.fn(),
  debounced: undefined as string | undefined,
  realLabels: false,
}));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: mocks.search, useAnswerSite: mocks.answer }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [mocks.debounced ?? value] }));
vi.mock('@nibleaf/i18n/site', async (importOriginal) => {
  const { siteT } = await importOriginal<typeof import('@nibleaf/i18n/site')>();
  return { siteT: (language?: string) => (mocks.realLabels ? siteT(language) : (key: string) => key) };
});

import { SiteSearch } from './site-search';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];
const hit = { id: 'setup', path: 'setup', title: 'Setup guide', snippet: 'Configure the project.', language: 'en', icon: null };

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
  mocks.debounced = undefined;
  mocks.realLabels = false;
  mocks.search.mockReturnValue({ data: [], isFetching: false, error: null });
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
  return { props, rerender };
}

const typeQuery = (value: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });

const selectAnswers = () =>
  act(async () => {
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent?.includes('askAi'));
    tab?.click();
  });

describe('published reader search', () => {
  it.each([
    ['en', 'Search documentation', 'Results'],
    ['ar', 'البحث في الوثائق', 'النتائج'],
    ['ar-SA', 'البحث في الوثائق', 'النتائج'],
  ])('names the combobox and controlled result list in %s, independently of a custom placeholder', async (lang, label, results) => {
    mocks.realLabels = true;
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render({ lang, placeholder: 'Custom site prompt', aiAnswers: false });
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    const list = document.querySelector('[role="listbox"]');
    expect(document.getElementById(input?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(label);
    expect(input?.placeholder).toBe('Custom site prompt');
    expect(list?.getAttribute('aria-label')).toBe(results);
    expect(input?.getAttribute('aria-controls')).toBe(list?.id);
    await typeQuery('setup');
    expect(list?.querySelector('[role="option"]')?.textContent).toContain('Setup guide');
  });

  it('distinguishes an unavailable search from a successful empty result and hides cached results on failure', async () => {
    const { rerender } = await render();
    await typeQuery('setup');
    expect(document.body.textContent).toContain('searchEmpty');
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: new Error('Network unavailable') });
    await rerender();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('searchFailed');
    expect(document.body.textContent).not.toContain('Setup guide');
  });

  it('does not show old results while waiting for the typed query debounce or after the input is cleared', async () => {
    mocks.search.mockReturnValue({ data: [hit], isFetching: false, error: null });
    await render();
    await typeQuery('setup');
    expect(document.body.textContent).toContain('Setup guide');
    mocks.debounced = 'setup';
    await typeQuery('billing');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('searching');
    expect(document.body.textContent).not.toContain('Setup guide');
    await typeQuery('');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('searchPrompt');
    expect(document.body.textContent).not.toContain('Setup guide');
  });

  it('submits an AI question with Enter and provides a visible search close action', async () => {
    const { props } = await render();
    await typeQuery('How do I start?');
    await selectAnswers();
    await act(async () => {
      document.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(mocks.mutate).toHaveBeenCalledWith({ projectId: 'docs', query: 'How do I start?', language: 'en' });
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="closeSearch"]');
    expect(close).not.toBeNull();
    await act(async () => close?.click());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(['en', 'ar', 'he', 'fa', 'ur', 'ar-SA', 'he-IL', 'fa-IR', 'ur-PK'])(
    'supports keyboard mode tabs and the content direction in %s',
    async (lang) => {
      await render({ lang });
      const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
      await act(async () => {
        tabs[0]?.focus();
        tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: lang === 'en' ? 'ArrowRight' : 'ArrowLeft', bubbles: true, cancelable: true }));
      });
      expect(document.activeElement).toBe(tabs[1]);
      expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
      expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(tabs[1]?.id);
      expect(document.querySelector('[role="tabpanel"]')?.id).toBe(tabs[1]?.getAttribute('aria-controls'));
      expect(document.querySelector('[role="tabpanel"]')?.getAttribute('dir')).toBe(lang === 'en' ? 'ltr' : 'rtl');
      await act(async () => tabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(tabs[0]);
      expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    },
  );

  it('honors the published language direction without changing the requested answer language', async () => {
    await render({ lang: 'en', direction: 'rtl' });
    await typeQuery('How do I start?');
    await selectAnswers();
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute('dir')).toBe('rtl');
    await act(async () =>
      document.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
    );
    expect(mocks.mutate).toHaveBeenCalledWith({ projectId: 'docs', query: 'How do I start?', language: 'en' });
  });

  it('returns to keyword search if AI answers are disabled while its panel is open', async () => {
    const { rerender } = await render();
    await selectAnswers();
    expect(document.body.textContent).toContain('groundedAnswerTitle');
    await rerender({ aiAnswers: false });
    expect(document.body.textContent).not.toContain('groundedAnswerTitle');
    expect(document.body.textContent).toContain('searchPrompt');
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
    await selectAnswers();
    expect(document.body.textContent).toContain('The saved answer');
    expect(document.body.textContent).toContain('Saved source');
    if (scope === 'query') await typeQuery('billing');
    else await rerender(scope === 'language' ? { lang: 'ar' } : { version: 'v2' });
    expect(document.body.textContent).not.toContain('The saved answer');
    expect(document.body.textContent).not.toContain('Saved source');
  });
});
