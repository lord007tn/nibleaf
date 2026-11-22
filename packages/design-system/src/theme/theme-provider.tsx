import { ScriptOnce } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = Exclude<Theme, 'system'>;

export const THEME_STORAGE_KEY = 'nibleaf.theme';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

interface ThemeProviderProps {
  applyDocumentTheme?: boolean;
  children: ReactNode;
  defaultTheme?: Theme;
  /** Allows a route-owned appearance system to keep its own pre-hydration script. */
  initialThemeScript?: string;
  storageKey?: string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isTheme = (value: string | null): value is Theme => value === 'light' || value === 'dark' || value === 'system';

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const resolveTheme = (theme: Theme): ResolvedTheme => (theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme);

const applyTheme = (theme: Theme): ResolvedTheme => {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  return resolved;
};

const scriptValue = (value: string): string =>
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

function getThemeScript(storageKey: string, defaultTheme: Theme): string {
  const key = scriptValue(storageKey);
  const fallback = scriptValue(defaultTheme);
  return `(function(){try{var t;try{t=localStorage.getItem(${key})}catch(_){}if(t!=='light'&&t!=='dark'&&t!=='system'){t=${fallback}}var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=t==='system'?(d?'dark':'light'):t;var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r}catch(_){}})();`;
}

export function ThemeProvider({
  applyDocumentTheme: shouldApplyDocumentTheme = true,
  children,
  defaultTheme = 'system',
  initialThemeScript,
  storageKey = THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      // Storage can be unavailable in privacy-restricted browsing contexts.
    }
    const initialTheme = isTheme(stored) ? stored : defaultTheme;
    // A transition, never a default-priority update (#650). This runs right
    // after hydration, and it changes the context above every Suspense
    // boundary still waiting for its code (a lazy marketing page, a reader
    // island). React can't hydrate a boundary that changed under it: at default
    // priority it drops the server HTML for the fallback until the code
    // arrives. A transition waits for those boundaries to hydrate instead. The
    // document already shows this theme, set by the script below.
    startTransition(() => {
      setThemeState(initialTheme);
      setResolvedTheme(resolveTheme(initialTheme));
      setMounted(true);
    });
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    setResolvedTheme(shouldApplyDocumentTheme ? applyTheme(theme) : resolveTheme(theme));
  }, [mounted, shouldApplyDocumentTheme, theme]);

  useEffect(() => {
    if (!mounted || theme !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolvedTheme(shouldApplyDocumentTheme ? applyTheme('system') : resolveTheme('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mounted, shouldApplyDocumentTheme, theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Storage can be unavailable in privacy-restricted browsing contexts.
      }
      setThemeState(next);
    },
    [storageKey],
  );

  // The same value until the theme changes, so a re-render alone never counts
  // as a context change for the boundaries above.
  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      <ScriptOnce>{initialThemeScript ?? getThemeScript(storageKey, defaultTheme)}</ScriptOnce>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  return context ?? { theme: 'system', resolvedTheme: 'light', setTheme: () => undefined };
}
