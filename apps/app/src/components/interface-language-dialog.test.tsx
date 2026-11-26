// @vitest-environment jsdom
import { computeAccessibleName } from 'dom-accessibility-api';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-messages', () => ({ useAuthLocale: () => ({ locale: 'ar', setLocale: vi.fn(), t: (key: string) => key }) }));

import { InterfaceLanguageDialog } from './interface-language-dialog';

globalThis.ResizeObserver ??= class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= vi.fn();
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

const open = async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<InterfaceLanguageDialog onOpenChange={() => undefined} open />));
};

describe('interface language dialog (PUBLIC-16)', () => {
  it('names its search box and its list for screen readers', async () => {
    await open();
    const input = document.querySelector<HTMLInputElement>('[cmdk-input]');
    expect(input).not.toBeNull();
    expect(computeAccessibleName(input as HTMLInputElement)).toBe('account.language.search');
    const list = document.querySelector('[role="listbox"]');
    expect(computeAccessibleName(list as Element)).toBe('account.language');
  });

  it('says which language is in use, not only with a hidden check mark', async () => {
    await open();
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(1);
    const checked = options.filter((option) => option.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain('العربية');
    for (const option of options) expect(option.getAttribute('aria-checked')).toMatch(/^(true|false)$/);
  });

  it('draws one check mark per option', async () => {
    await open();
    const option = document.querySelector('[role="option"][aria-checked="true"]');
    expect(option?.querySelectorAll('svg')).toHaveLength(1);
  });
});
