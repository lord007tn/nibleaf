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
