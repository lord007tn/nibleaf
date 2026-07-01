import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// A small theme provider that works with TanStack Start's SSR (next-themes does
// not reliably apply the class here). It toggles `.dark` on <html>, persists the
// choice, follows the system preference for `theme: 'system'`, and pairs with the
// no-flash inline script in __root so there's no light flash before hydration.

export type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'midad.theme';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: Resolved;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const resolve = (theme: Theme): Resolved => (theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme);

const apply = (resolved: Resolved) => {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
};

/** The inline script (run in <head> before hydration) that sets the initial
 *  `.dark` class from the stored/system theme, so there's no flash of light. */
export const THEME_NOFLASH_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k);var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<Resolved>('light');

  // Hydrate from localStorage on the client (SSR renders the 'system' default;
  // the no-flash script already set the real class on <html>).
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    const initial = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    setThemeState(initial);
    setResolvedTheme(resolve(initial));
  }, []);

  // Apply + persist whenever the choice changes.
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const r = resolve(next);
    setResolvedTheme(r);
    apply(r);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (_) {
      // ignore (private mode etc.)
    }
  }, []);

  // Follow OS changes while on 'system'.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r = prefersDark() ? 'dark' : 'light';
      setResolvedTheme(r);
      apply(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? { theme: 'system', resolvedTheme: 'light', setTheme: () => undefined };
}
