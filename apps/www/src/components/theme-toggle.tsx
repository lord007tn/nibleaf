import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Avoid a wrong-icon flash: the raw theme is only known after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Cycle system → light → dark → system so a visitor can always return to system.
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';

  return (
    <button
      // Stable label until mounted so the SSR markup matches the first client
      // render (the resolved theme is only known after hydration).
      aria-label={mounted ? `Switch to ${next} theme` : 'Toggle theme'}
      className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
      onClick={() => setTheme(next)}
      type="button"
    >
      {mounted && theme === 'light' ? (
        <Sun className="size-4" />
      ) : mounted && theme === 'dark' ? (
        <Moon className="size-4" />
      ) : (
        <Monitor className="size-4" />
      )}
    </button>
  );
}
