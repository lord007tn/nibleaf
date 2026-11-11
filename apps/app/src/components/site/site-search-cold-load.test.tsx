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

const compose = (field: HTMLInputElement, preedit: string) =>
  act(async () => {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, preedit);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
  });
/** Commits a composition the way Chrome does: the final input, then compositionend. */
const commit = (field: HTMLInputElement, committed: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, committed);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

it('hands every key and composition typed after ⌘K through the loading shell to the dialog', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<SiteSearch projectId="docs" open={false} onOpenChange={vi.fn()} lang="en" />));
  // ⌘K: keys typed before the shell renders go into a hidden field focused at once.
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  const hidden = document.activeElement as HTMLInputElement;
  expect(hidden.hasAttribute('data-search-keystrokes')).toBe(true);
  await act(async () => setValue(hidden, 'r'));
  // Proxy → shell: an IME candidate window is open in the hidden field when the shell appears.
  await compose(hidden, 'rか');
  await act(async () => root.render(<SiteSearch projectId="docs" open onOpenChange={vi.fn()} lang="en" />));
  const shellInput = document.querySelector<HTMLInputElement>('[data-search-shell] input');
  // The shell waits: focus stays in the composing field, its pre-edit untouched.
  expect(document.activeElement).toBe(hidden);
  expect(hidden.value).toBe('rか');
  await commit(hidden, 'r課');
  expect(document.activeElement).toBe(shellInput);
  expect(shellInput?.value).toBe('r課');
  await act(async () => setValue(shellInput, 'r課e'));
  // Shell → dialog: the chunk arrives while a composition is open in the shell.
  if (!shellInput) throw new Error('Missing shell field');
  await compose(shellInput, 'r課eふ');
  gate.release();
  // The gated chunk resolves asynchronously (its module graph can take a few
  // seconds to import on a busy machine); wait until the real dialog mounts.
  for (let attempt = 0; attempt < 200 && !document.querySelector('[data-slot="command-input"]'); attempt += 1) {
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  }
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
  expect(input).not.toBeNull();
  // The dialog is ready but waits: the shell and its composing field stay, focused.
  expect(document.querySelector('[data-search-shell]')).not.toBeNull();
  expect(document.activeElement).toBe(shellInput);
  expect(shellInput.value).toBe('r課eふ');
  await commit(shellInput, 'r課e付');
  expect(document.querySelector('[data-search-shell]')).toBeNull();
  expect(input?.value).toBe('r課e付');
  expect(document.activeElement).toBe(input);
  expect(input?.selectionStart).toBe(4);
  expect(document.querySelector('[data-search-keystrokes]')).toBeNull();
  await act(async () => root.unmount());
}, 15_000);
