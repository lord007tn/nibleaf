/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useLanguages: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => mocks.t }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useCreateLanguage: () => ({ mutateAsync: mocks.mutateAsync }),
  useLanguages: mocks.useLanguages,
}));

import { AddLanguageDialog } from './add-language-dialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];

/** Base UI's dialog popup and cmdk's list rely on browser APIs jsdom does not implement. */
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
  mocks.t.mockImplementation((key: string) => key);
  mocks.useLanguages.mockReturnValue({ data: [{ id: 'lang-en', code: 'en', label: 'English' }] });
  mocks.mutateAsync.mockImplementation(async (body: { code: string; label: string; direction: string }) => ({ id: 'lang-new', ...body }));
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(onCreated = vi.fn()) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<AddLanguageDialog projectId="project-1" open onOpenChange={vi.fn()} onCreated={onCreated} />));
  return onCreated;
}

const optionFor = (code: string): HTMLElement => {
  const options = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item], [role="option"]'));
  const option = options.find((element) => element.textContent?.includes(code) && element.textContent.includes('Arabic'));
  if (!option) {
    throw new Error(`No option for ${code} in: ${options.map((element) => element.textContent).join(' | ')}`);
  }
  return option;
};

describe('AddLanguageDialog', () => {
  it.each([
    ['Arab', ['Arabic']],
    ['Brasil', ['Português (Brasil)']],
    ['pt-B', ['Português (Brasil)']],
    ['zzz', []],
  ])('offers only prefix or word-start matches for %s as accessible options', async (search, expected) => {
    await render();
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    if (!input) throw new Error('Combobox not rendered');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, search);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const list = document.getElementById(input.getAttribute('aria-controls') ?? '');
    if (!list) throw new Error('Listbox not controlled by combobox');
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options).toHaveLength(expected.length);
    expected.forEach((name, index) => {
      expect(options[index]?.textContent).toContain(name);
    });
    const active = input.getAttribute('aria-activedescendant');
    if (expected.length) expect(document.getElementById(active ?? '')?.getAttribute('aria-selected')).toBe('true');
    else expect(active).toBeNull();
  });

  it('adds the selected language with the keyboard while focus stays in the combobox', async () => {
    await render();
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    if (!input) throw new Error('Combobox not rendered');
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Arab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(input);
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ code: 'ar', direction: 'RTL' }));
  });

  it('stores the native name as the language label while keeping the English name searchable', async () => {
    const onCreated = await render();

    const arabic = optionFor('ar');
    // The English name stays in the row (and the cmdk value) for search.
    expect(arabic.textContent).toContain('العربية');
    expect(arabic.textContent).toContain('Arabic');

    await act(async () => {
      arabic.click();
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith({ code: 'ar', label: 'العربية', direction: 'RTL' });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ code: 'ar', label: 'العربية' }));
  });

  it('hides languages the project already has', async () => {
    await render();

    const options = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item], [role="option"]'));
    expect(options.some((element) => element.textContent?.includes('English'))).toBe(false);
  });
});
