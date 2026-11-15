// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('@/lib/auth-messages', () => ({ useAuthLocale: () => ({ locale: 'en', setLocale: locale.set, t: (key: string) => key }) }));
const loader = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/components/interface-language-picker', () => ({ loadInterfaceLanguagePicker: loader.load }));

import { InterfaceLanguageButton } from './interface-language-button';

// cmdk measures its list and scrolls the active item into view; jsdom has neither.
globalThis.ResizeObserver ??= class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= vi.fn();

const realPicker = async () =>
  (await vi.importActual<typeof import('./interface-language-dialog')>('./interface-language-dialog')).InterfaceLanguageDialog;

let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  loader.load.mockReset();
  locale.set.mockReset();
  // A download that takes a moment, like a real chunk.
  loader.load.mockImplementation(() => new Promise((done) => setTimeout(() => done(realPicker()), 20)));
});
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
const dialog = () => document.querySelector('[role="dialog"]');
const press = async (target: Element | null, key: string) => {
  await act(async () => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

describe('InterfaceLanguageButton', () => {
  it('does not import the picker dialog (cmdk) until it is needed', () => {
    const button = readFileSync(resolve(import.meta.dirname, 'interface-language-button.tsx'), 'utf8');
    const picker = readFileSync(resolve(import.meta.dirname, 'interface-language-picker.ts'), 'utf8');
    for (const source of [button, picker]) {
      expect(source).not.toMatch(/^import[^;]*interface-language-dialog/m);
      expect(source).not.toMatch(/components\/ui\/command/);
    }
    expect(picker).toContain("import('@/components/interface-language-dialog')");
  });

  it('renders no dialog and loads nothing until it is hovered, focused or opened', async () => {
    await mount();
    expect(dialog()).toBeNull();
    expect(loader.load).not.toHaveBeenCalled();
  });

  it('opens after the download with focus in its search; Escape returns focus to the button; it reopens', async () => {
    const button = await mount();
    // A real click focuses the button (jsdom's click() doesn't); that starts the
    // download, and the click right after waits for that same download.
    button.focus();
    await act(async () => button.click());
    // The first real import of the dialog module (cmdk) is slow under the test transform.
    await vi.waitFor(() => expect(dialog()).not.toBeNull(), { timeout: 10_000 });
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('[cmdk-input]')));
    expect(dialog()?.textContent).toContain('account.language');

    await press(document.activeElement, 'Escape');
    await vi.waitFor(() => expect(document.activeElement).toBe(button));

    await act(async () => button.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('[cmdk-input]')));
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain language list, with focus, when the download fails (offline)', async () => {
    loader.load.mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'));
    const button = await mount();
    button.focus();
    await act(async () => button.click());
    await vi.waitFor(() => expect(document.querySelector('details')).not.toBeNull());
    const details = document.querySelector('details') as HTMLDetailsElement;
    const summary = details.querySelector('summary') as HTMLElement;
    expect(dialog()).toBeNull();
    expect(button.isConnected).toBe(false);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    expect(summary.getAttribute('aria-label')).toBe('account.language');
    const options = [...details.querySelectorAll('li button')] as HTMLButtonElement[];
    expect(options.length).toBeGreaterThan(1);
    const named = (code: string) => options.find((option) => option.querySelector('bdi')?.lang === code);
    expect(named('en')?.getAttribute('aria-current')).toBe('true');
    const arabic = named('ar');
    expect(arabic?.querySelector('bdi')?.dir).toBe('rtl');
    await act(async () => arabic?.click());
    expect(locale.set).toHaveBeenCalledWith('ar');
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('ignores a failed preload on hover or focus', async () => {
    loader.load.mockRejectedValueOnce(new TypeError('offline'));
    const button = await mount();
    await act(async () => button.focus());
    await act(async () => Promise.resolve());
    expect(dialog()).toBeNull();
    // A failed preload alone changes nothing: the button stays, and a press asks again.
    expect(document.querySelector('details')).toBeNull();
    expect(button.isConnected).toBe(true);
  });
});
