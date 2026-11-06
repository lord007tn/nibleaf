// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Hold the dialog's code back until the test releases it, to exercise the real
// Suspense fallback (the lightweight shell) and its handoff to the dialog.
const gate = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release: () => release() };
});
vi.mock('./site-search-dialog', async (importOriginal) => {
  await gate.ready;
  return importOriginal();
});
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock('@/hooks/api/site-search', () => ({
  useSiteSearch: () => ({ data: [], isFetching: false, error: null }),
  useAnswerSite: () => ({ mutate: vi.fn(), variables: undefined, isPending: false, data: null, error: null }),
}));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [value] }));

import { SiteSearch } from './site-search';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

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
});

afterEach(() => {
  document.body.replaceChildren();
});

const setValue = (field: HTMLInputElement | null, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
  field?.dispatchEvent(new Event('input', { bubbles: true }));
};

it('closes the loading shell and returns focus to where the reader was', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onOpenChange = vi.fn();
  await act(async () => root.render(<SiteSearch projectId="docs" open={false} onOpenChange={onOpenChange} lang="ar" />));
  // The reader focuses the search trigger (e.g. by clicking it) before search opens.
  await act(async () => trigger.focus());
  await act(async () => root.render(<SiteSearch projectId="docs" open onOpenChange={onOpenChange} lang="ar" />));
  const shell = document.querySelector('[data-search-shell] [role="dialog"]');
  // Arabic without an explicit direction still lays the shell out right to left.
  expect(shell?.getAttribute('dir')).toBe('rtl');
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(document.activeElement).toBe(trigger);
  await act(async () => root.unmount());
});

it('hands text typed into the loading shell to the dialog, with focus and the caret at the end', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<SiteSearch projectId="docs" open onOpenChange={vi.fn()} lang="en" />));
  const shellInput = document.querySelector<HTMLInputElement>('[data-search-shell] input');
  expect(document.activeElement).toBe(shellInput);
  await act(async () => setValue(shellInput, 'ref'));
  gate.release();
  // The gated chunk resolves asynchronously; wait until the real dialog replaces the shell.
  for (let attempt = 0; attempt < 100 && !document.querySelector('[data-slot="command-input"]'); attempt += 1) {
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  }
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
  expect(document.querySelector('[data-search-shell]')).toBeNull();
  expect(input?.value).toBe('ref');
  expect(document.activeElement).toBe(input);
  expect(input?.selectionStart).toBe(3);
  await act(async () => root.unmount());
});
