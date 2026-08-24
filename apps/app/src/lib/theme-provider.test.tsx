// @vitest-environment jsdom

import { runInNewContext } from 'node:vm';
import { THEME_STORAGE_KEY, type Theme, ThemeProvider, useTheme } from '@nibleaf/design-system/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scriptOnce = vi.hoisted(() => ({ children: '' }));

vi.mock('@tanstack/react-router', () => ({
  ScriptOnce: ({ children }: { children: string }) => {
    scriptOnce.children = children;
    return null;
  },
}));

function ThemeProbe() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  return (
    <div data-resolved-theme={resolvedTheme} data-theme={theme}>
      {(['light', 'dark', 'system'] as const).map((value) => (
        <button key={value} onClick={() => setTheme(value)} type="button">
          {value}
        </button>
      ))}
    </div>
  );
}

describe('ThemeProvider', () => {
  let container: HTMLDivElement;
  let root: Root;
  let systemDark: boolean;
  let mediaListeners: Set<() => void>;

  const renderProvider = async (
    props: { applyDocumentTheme?: boolean; defaultTheme?: Theme; initialThemeScript?: string; storageKey?: string } = {},
  ) => {
    await act(async () => {
      root.render(
        <ThemeProvider {...props}>
          <ThemeProbe />
        </ThemeProvider>,
      );
    });
  };

  const probe = () => container.querySelector<HTMLDivElement>('[data-theme]');
  const choose = async (theme: Theme) => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button:nth-of-type(${theme === 'light' ? 1 : theme === 'dark' ? 2 : 3})`)?.click();
    });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    systemDark = false;
    mediaListeners = new Set();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: systemDark,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    window.localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.style.colorScheme = '';
    scriptOnce.children = '';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('injects a pre-hydration script that resolves the stored theme before content', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    renderToStaticMarkup(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );
    document.documentElement.classList.add('light');
    runInNewContext(scriptOnce.children, { document, localStorage: window.localStorage, window });

    expect(scriptOnce.children).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('lets the published documentation route keep its separate bootstrap', () => {
    const siteThemeScript = 'window.__siteThemeApplied = true';

    renderToStaticMarkup(
      <ThemeProvider initialThemeScript={siteThemeScript}>
        <div>site</div>
      </ThemeProvider>,
    );

    expect(scriptOnce.children).toBe(siteThemeScript);
  });

  it('does not overwrite a route-owned document theme after hydration', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    document.documentElement.classList.add('light');
    document.documentElement.style.colorScheme = 'light';

    await renderProvider({ applyDocumentTheme: false, initialThemeScript: '/* site-owned */' });

    expect(probe()?.dataset.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists explicit choices and exposes the resolved theme to consumers', async () => {
    await renderProvider();
    await choose('dark');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(probe()?.dataset.theme).toBe('dark');
    expect(probe()?.dataset.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('follows system preference changes only while system mode is active', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    await renderProvider();

    expect(probe()?.dataset.resolvedTheme).toBe('light');
    expect(mediaListeners.size).toBe(1);

    systemDark = true;
    await act(async () =>
      mediaListeners.forEach((listener) => {
        listener();
      }),
    );
    expect(probe()?.dataset.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await choose('light');
    expect(mediaListeners.size).toBe(0);
    systemDark = false;
    await act(async () =>
      mediaListeners.forEach((listener) => {
        listener();
      }),
    );
    expect(probe()?.dataset.resolvedTheme).toBe('light');
  });

  it('falls back to the default for invalid stored values', async () => {
    systemDark = true;
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    await renderProvider();

    expect(probe()?.dataset.theme).toBe('system');
    expect(probe()?.dataset.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
