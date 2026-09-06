// @vitest-environment jsdom

import type { Locale, MessageKey, MessageVariables } from '@nibleaf/i18n';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({ locale: 'en' as string, setLocale: vi.fn() }));
const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));

// Real catalogs, controlled locale: the tab must render the *translated* strings.
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const useLocale = () => ({
    locale: i18n.locale as Locale,
    setLocale: i18n.setLocale,
    t: (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, i18n.locale as Locale),
  });
  return { useLocale, useT: () => useLocale().t };
});
vi.mock('@nibleaf/design-system/theme', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: theme.setTheme }),
}));

import { AppearanceTab } from './appearance-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const selectValue = (scope: ParentNode) => scope.querySelector<HTMLElement>('[data-slot="select-value"]');

describe('AppearanceTab', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => root.render(<AppearanceTab />));
  };

  beforeEach(() => {
    i18n.locale = 'en';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('renders the translated theme section in English', async () => {
    await render();

    const headings = [...container.querySelectorAll('h2')].map((heading) => heading.textContent);
    expect(headings).toEqual(['Theme', 'Interface language']);
    const buttons = [...container.querySelectorAll('button[type="button"]')].map((button) => button.textContent);
    expect(buttons).toContain('Light');
    expect(buttons).toContain('Dark');
  });

  it('renders the translated theme section in Arabic', async () => {
    i18n.locale = 'ar';
    await render();

    const headings = [...container.querySelectorAll('h2')].map((heading) => heading.textContent);
    expect(headings).toEqual(['السمة', 'لغة الواجهة']);
    const buttons = [...container.querySelectorAll('button[type="button"]')].map((button) => button.textContent);
    expect(buttons).toContain('فاتح');
    expect(buttons).toContain('داكن');
    expect(container.textContent).not.toContain('Theme');
  });

  it('shows the native language name in the trigger instead of the locale code', async () => {
    await render();
    const english = selectValue(container);
    expect(english?.textContent).toBe('English');
    expect(english?.getAttribute('lang')).toBe('en');
    expect(english?.getAttribute('dir')).toBe('ltr');

    i18n.locale = 'ar';
    await render();
    const arabic = selectValue(container);
    expect(arabic?.textContent).toBe('العربية');
    expect(arabic?.textContent).not.toBe('ar');
    expect(arabic?.getAttribute('lang')).toBe('ar');
    expect(arabic?.getAttribute('dir')).toBe('rtl');
  });

  it('shows the native language name on the server render too', () => {
    i18n.locale = 'ar';
    const markup = renderToStaticMarkup(<AppearanceTab />);
    const doc = new DOMParser().parseFromString(markup, 'text/html');

    expect(selectValue(doc)?.textContent).toBe('العربية');
  });

  it('switches the dashboard theme from the theme cards', async () => {
    await render();
    const dark = [...container.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find((button) => button.textContent === 'Dark');

    await act(async () => dark?.click());

    expect(theme.setTheme).toHaveBeenCalledWith('dark');
  });
});
