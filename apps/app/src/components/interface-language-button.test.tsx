// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-messages', () => ({ useAuthLocale: () => ({ locale: 'en', setLocale: vi.fn(), t: (key: string) => key }) }));

import { InterfaceLanguageButton } from './interface-language-button';

// cmdk measures its list and scrolls the active item into view; jsdom has neither.
globalThis.ResizeObserver ??= class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= vi.fn();

let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

const mount = async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<InterfaceLanguageButton />));
  const button = host.querySelector('button');
  if (!button) throw new Error('no button');
  return button;
};

describe('InterfaceLanguageButton', () => {
  it('does not import the picker dialog (cmdk) until it is needed', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'interface-language-button.tsx'), 'utf8');
    expect(source).not.toMatch(/^import[^;]*interface-language-dialog/m);
    expect(source).not.toMatch(/components\/ui\/command/);
    expect(source).toContain("import('@/components/interface-language-dialog')");
  });

  it('renders no dialog until it is opened', async () => {
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens the picker with focus in its search, and Escape returns focus to the button', async () => {
    const button = await mount();
    button.focus();
    await act(async () => button.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('[cmdk-input]')));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('account.language');

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });
});
